require('regenerator-runtime/runtime');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../lib/auth');
const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

// ── Auth middleware ────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const userId = (req.session && req.session.userId) || verifyToken(req);
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    if (!req.session) req.session = {};
    req.session.userId = userId;
    next();
}

// ── Multer (memory) for AI processing ─────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Gemini API helper with automatic fallback & retry ─────────────
const GEMINI_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-pro-latest'
];

async function callGemini(preferredModel, contents) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
        throw new Error('API key is not configured. Please ensure GEMINI_API_KEY is set in your environment.');
    }

    const modelsToTry = [
        preferredModel || GEMINI_MODELS[0],
        ...GEMINI_MODELS.filter(m => m !== preferredModel)
    ];

    let lastError = null;

    for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents }),
                signal: AbortSignal.timeout(25000)
            });

            if (resp.ok) {
                return await resp.json();
            }

            const errText = await resp.text();
            let errMsg = errText;
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error && errJson.error.message) {
                    errMsg = errJson.error.message;
                }
            } catch(e) {}

            if (resp.status === 400 && (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID'))) {
                throw new Error('Invalid API key provided. Please check the API configuration.');
            }

            // High demand (503) or Rate Limit (429) or Model unavailable (404) -> Fallback to next model
            if (resp.status === 503 || resp.status === 429 || resp.status === 404) {
                console.warn(`[callGemini] Model ${model} returned ${resp.status} (${errMsg.slice(0, 80)}). Trying fallback model...`);
                lastError = new Error(`Service model (${model}) is temporarily unavailable due to high demand.`);
                if (i < modelsToTry.length - 1) {
                    await new Promise(res => setTimeout(res, 800)); // small delay before next model
                    continue;
                }
            } else {
                throw new Error(`Service error (${resp.status}): ${errMsg}`);
            }
        } catch(netErr) {
            if (netErr.message.includes('Invalid API key')) throw netErr;
            console.warn(`[callGemini] Exception on model ${model}:`, netErr.message);
            lastError = netErr;
            if (i < modelsToTry.length - 1) {
                await new Promise(res => setTimeout(res, 800));
                continue;
            }
        }
    }

    throw lastError || new Error('The service is temporarily busy due to high traffic. Please try again in a few moments.');
}

// Helper: extract text from PDF buffer using pdf-parse (supports both v1 and v2)
async function extractPdfText(buffer) {
    try {
        const pdf = require('pdf-parse');
        if (typeof pdf === 'function') {
            const data = await pdf(buffer);
            return (data && data.text) ? data.text.trim() : '';
        }
        if (pdf && pdf.PDFParse) {
            const parser = new pdf.PDFParse({ data: buffer });
            try {
                const res = await parser.getText();
                return (res && res.text) ? res.text.trim() : '';
            } finally {
                if (typeof parser.destroy === 'function') {
                    try { await parser.destroy(); } catch(e) {}
                }
            }
        }
    } catch(e) {
        console.error('[extractPdfText] error:', e.message);
    }
    return '';
}

// Helper: fetch file buffer from Supabase storage by file ID
async function fetchFileBuffer(fileId) {
    const { data: file, error } = await supabaseAdmin.from('files')
        .select('file_path, original_name, mime_type')
        .eq('id', fileId)
        .eq('is_deleted', 0)
        .maybeSingle();
    if (error || !file) throw new Error('File not found');

    const storagePath = file.file_path.split('/userfiles/')[1];
    if (!storagePath) throw new Error('Invalid file path');

    const { data, error: dlErr } = await supabaseAdmin.storage.from('userfiles').download(storagePath);
    if (dlErr) throw new Error('Failed to download file: ' + dlErr.message);

    const buffer = Buffer.from(await data.arrayBuffer());
    return { buffer, file };
}

// Helper: save a buffer as a new file in the user's drive (with auto-unique duplicate protection)
async function saveBufferToDrive(userId, buffer, filename, mimeType, folderId) {
    let dupQuery = supabaseAdmin.from('files').select('id')
        .eq('user_id', userId)
        .eq('original_name', filename)
        .or('is_deleted.eq.0,is_deleted.is.null');
    if (folderId) dupQuery = dupQuery.eq('folder_id', folderId);
    else dupQuery = dupQuery.is('folder_id', null);
    const { data: existingDups } = await dupQuery;

    let finalName = filename;
    let isDuplicate = false;
    if (existingDups && existingDups.length > 0) {
        isDuplicate = true;
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        finalName = `${base} (${existingDups.length})${ext}`;
    }

    const safeName = `${Date.now()}-${finalName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `${userId}/${safeName}`;

    const { error: uploadError } = await supabaseAdmin.storage
        .from('userfiles')
        .upload(filePath, buffer, { contentType: mimeType });
    if (uploadError) throw new Error('Storage upload failed: ' + uploadError.message);

    const { data: urlData } = supabaseAdmin.storage.from('userfiles').getPublicUrl(filePath);

    const { data: inserted, error: dbError } = await supabaseAdmin.from('files').insert([{
        user_id: userId,
        original_name: finalName,
        file_path: urlData.publicUrl,
        file_size: buffer.length,
        mime_type: mimeType,
        folder_id: folderId || null,
        is_deleted: 0
    }]).select();
    if (dbError) throw new Error('DB insert failed: ' + dbError.message);

    return { ...inserted[0], is_duplicate: isDuplicate };
}

// ══════════════════════════════════════════════════════════════════
// 1. ONE-CLICK CONVERSION — Image → PDF  /  DOCX → PDF
// POST /api/ai/convert
// Body: { fileId, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/convert', requireAuth, async (req, res) => {
    try {
        const { fileId, targetFolderId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        const mime = file.mime_type || '';
        const originalName = file.original_name || 'file';
        const baseName = originalName.replace(/\.[^.]+$/, '');

        let pdfBuffer;

        // ── Image → PDF ──────────────────────────────────────────
        if (mime.startsWith('image/')) {
            const { PDFDocument } = require('pdf-lib');
            const pdfDoc = await PDFDocument.create();

            let embedFn;
            let imgBuffer = buffer;

            // Convert any image to JPEG using sharp if not jpg/png
            if (mime === 'image/jpeg' || mime === 'image/jpg') {
                embedFn = 'embedJpg';
            } else if (mime === 'image/png') {
                embedFn = 'embedPng';
            } else {
                // Convert to jpeg via sharp
                try {
                    const sharp = require('sharp');
                    imgBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
                    embedFn = 'embedJpg';
                } catch (e) {
                    return res.status(400).json({ error: 'Unsupported image type. Use JPG or PNG.' });
                }
            }

            const img = await pdfDoc[embedFn](imgBuffer);
            const { width, height } = img.scale(1);

            // A4: 595 x 842 pts — scale image to fit
            const pageW = 595, pageH = 842;
            const scale = Math.min(pageW / width, pageH / height, 1);
            const drawW = width * scale;
            const drawH = height * scale;
            const x = (pageW - drawW) / 2;
            const y = (pageH - drawH) / 2;

            const page = pdfDoc.addPage([pageW, pageH]);
            page.drawImage(img, { x, y, width: drawW, height: drawH });

            pdfBuffer = Buffer.from(await pdfDoc.save());

        // ── DOCX → PDF ───────────────────────────────────────────
        } else if (
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            originalName.toLowerCase().endsWith('.docx') ||
            originalName.toLowerCase().endsWith('.doc')
        ) {
            const mammoth = require('mammoth');
            const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
            const fontkit = require('@pdf-lib/fontkit');

            // Extract plain text from DOCX
            const result = await mammoth.extractRawText({ buffer });
            const text = result.value || '';

            // Build PDF with Unicode font support
            const pdfDoc = await PDFDocument.create();
            pdfDoc.registerFontkit(fontkit);

            // Load Kalpurush font (supports English, Bengali, numbers, symbols)
            const localFontPath = path.join(__dirname, '..', 'lib', 'fonts', 'kalpurush.ttf');
            let font;
            if (fs.existsSync(localFontPath)) {
                const fontBytes = fs.readFileSync(localFontPath);
                font = await pdfDoc.embedFont(fontBytes);
            } else if (fs.existsSync('C:/Windows/Fonts/kalpurush.ttf')) {
                const fontBytes = fs.readFileSync('C:/Windows/Fonts/kalpurush.ttf');
                font = await pdfDoc.embedFont(fontBytes);
            } else {
                font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            }

            const fontSize = 11;
            const lineHeight = fontSize + 5;
            const pageW = 595, pageH = 842; // A4 standard
            const marginX = 50, marginTop = 792, marginBottom = 50;
            const maxW = pageW - marginX * 2;

            const paragraphs = text.split(/\r?\n/);
            const allLines = [];
            for (const para of paragraphs) {
                const words = para.trim().split(/\s+/).filter(Boolean);
                if (words.length === 0) {
                    allLines.push('');
                    continue;
                }
                let cur = '';
                for (const w of words) {
                    const test = cur ? cur + ' ' + w : w;
                    if (font.widthOfTextAtSize(test, fontSize) <= maxW) {
                        cur = test;
                    } else {
                        if (cur) allLines.push(cur);
                        if (font.widthOfTextAtSize(w, fontSize) > maxW) {
                            let part = '';
                            for (const char of w) {
                                if (font.widthOfTextAtSize(part + char, fontSize) <= maxW) {
                                    part += char;
                                } else {
                                    allLines.push(part);
                                    part = char;
                                }
                            }
                            cur = part;
                        } else {
                            cur = w;
                        }
                    }
                }
                if (cur) allLines.push(cur);
            }

            let page = pdfDoc.addPage([pageW, pageH]);
            let y = marginTop;
            for (const line of allLines) {
                if (y < marginBottom + lineHeight) {
                    page = pdfDoc.addPage([pageW, pageH]);
                    y = marginTop;
                }
                if (line) {
                    page.drawText(line, { x: marginX, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
                }
                y -= lineHeight;
            }

            pdfBuffer = Buffer.from(await pdfDoc.save());

        } else {
            return res.status(400).json({ error: 'Only images (JPG, PNG, WebP) and DOCX files can be converted to PDF.' });
        }

        const newName = `${baseName}.pdf`;
        const savedFile = await saveBufferToDrive(
            req.session.userId,
            pdfBuffer,
            newName,
            'application/pdf',
            targetFolderId || null
        );

        res.json({
            success: true,
            message: `"${newName}" successfully converted and saved to your Drive.`,
            file: { id: savedFile.id, name: savedFile.original_name, size: savedFile.file_size }
        });

    } catch (err) {
        console.error('[ai/convert] error:', err);
        res.status(500).json({ error: err.message || 'Conversion failed' });
    }
});



// ══════════════════════════════════════════════════════════════════
// 3. OCR — Tesseract.js text extraction from image/PDF
// POST /api/ai/ocr
// ══════════════════════════════════════════════════════════════════
// 3. OCR — Text extraction from image/PDF (Tesseract + Gemini Fallback)
// POST /api/ai/ocr
// Body: { fileId, saveToDrive?, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/ocr', requireAuth, async (req, res) => {
    try {
        const { fileId, saveToDrive, targetFolderId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        const mime = file.mime_type || '';
        const name = (file.original_name || '').toLowerCase();

        let extractedText = '';

        if (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name)) {
            // 1. Primary: Use Tesseract.js for image OCR with local eng.traineddata
            try {
                const { createWorker } = require('tesseract.js');
                const projectRoot = path.resolve(__dirname, '..');
                const worker = await createWorker('eng', 1, {
                    langPath: projectRoot,
                    cachePath: projectRoot
                });
                try {
                    const { data: { text } } = await worker.recognize(buffer);
                    extractedText = (text || '').trim();
                } finally {
                    await worker.terminate();
                }
            } catch (tessErr) {
                console.warn('[ocr] Tesseract failed, falling back to Gemini Vision OCR:', tessErr.message);
            }

            // 2. Fallback: If Tesseract got little/no text, use Gemini Vision
            if (!extractedText || extractedText.length < 15) {
                try {
                    const base64Img = buffer.toString('base64');
                    const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg';
                    const geminiRes = await callGemini('gemini-3-flash-preview', [
                        {
                            role: 'user',
                            parts: [
                                { inlineData: { mimeType: imgMime, data: base64Img } },
                                { text: 'Extract all legible text from this image exactly as written. Return ONLY the extracted text, with no preamble, formatting wrappers, or additional commentary.' }
                            ]
                        }
                    ]);
                    const parts = geminiRes.candidates?.[0]?.content?.parts || [];
                    const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
                    if (textPart && textPart.text) {
                        extractedText = textPart.text.trim();
                    }
                } catch(gErr) {
                    console.warn('[ocr] Gemini Vision OCR fallback error:', gErr.message);
                }
            }
        } else if (mime === 'application/pdf' || name.endsWith('.pdf')) {
            // 1. Primary: Extract embedded digital text from PDF
            const digitalText = await extractPdfText(buffer);
            const cleanDigital = (digitalText || '').replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();

            if (cleanDigital && cleanDigital.length >= 25) {
                extractedText = cleanDigital;
            } else {
                // 2. Fallback: If scanned / image-only PDF, use Gemini Multimodal OCR
                try {
                    const base64Pdf = buffer.toString('base64');
                    const geminiRes = await callGemini('gemini-3-flash-preview', [
                        {
                            role: 'user',
                            parts: [
                                { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                                { text: 'Extract all legible text from this scanned PDF document exactly as written. Return ONLY the raw extracted text without any commentary or explanation.' }
                            ]
                        }
                    ]);
                    const parts = geminiRes.candidates?.[0]?.content?.parts || [];
                    const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
                    if (textPart && textPart.text) {
                        extractedText = textPart.text.trim();
                    }
                } catch(pdfGeminiErr) {
                    console.warn('[ocr] Gemini PDF multimodal OCR error:', pdfGeminiErr.message);
                }

                // If Gemini failed or got nothing, retain any digital text available
                if (!extractedText && cleanDigital) {
                    extractedText = cleanDigital;
                }
            }
        } else if (
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            name.endsWith('.docx') ||
            name.endsWith('.doc')
        ) {
            // 3. Word documents (.docx, .doc) via mammoth
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                extractedText = (result.value || '').trim();
            } catch(docErr) {
                console.warn('[ocr] Mammoth DOCX extract error:', docErr.message);
            }
        } else if (
            mime.startsWith('text/') ||
            /\.(txt|md|csv|json|js|jsx|ts|tsx|html|htm|css|py|java|c|cpp|h|log|xml|yaml|yml|sql|sh)$/i.test(name)
        ) {
            // 4. Plain text & code files
            try {
                extractedText = buffer.toString('utf-8').trim();
            } catch(txtErr) {
                console.warn('[ocr] Text buffer decoding error:', txtErr.message);
            }
        } else {
            return res.status(400).json({ error: 'Text extraction supports images (JPG, PNG, WebP), PDFs, Word documents (.docx), and text/code files (.txt, .md, .csv).' });
        }

        if (!extractedText) {
            return res.json({ success: true, text: '', message: 'No text found in the file. Please ensure the document or image contains readable text.' });
        }

        let savedFile = null;
        if (saveToDrive) {
            const baseName = (file.original_name || 'ocr').replace(/\.[^.]+$/, '');
            const txtName = `${baseName}-ocr.txt`;
            const txtBuffer = Buffer.from(extractedText, 'utf-8');
            savedFile = await saveBufferToDrive(
                req.session.userId, txtBuffer, txtName, 'text/plain', targetFolderId || null
            );
        }

        res.json({
            success: true,
            text: extractedText,
            charCount: extractedText.length,
            wordCount: extractedText.split(/\s+/).filter(Boolean).length,
            savedFile: savedFile ? { id: savedFile.id, name: savedFile.original_name } : null,
            message: saveToDrive && savedFile ? `Text saved as "${savedFile.original_name}"` : 'Text extracted successfully.'
        });

    } catch (err) {
        console.error('[ai/ocr] error:', err);
        res.status(500).json({ error: err.message || 'OCR failed' });
    }
});

// ══════════════════════════════════════════════════════════════════
// 5. DOCUMENT SUMMARY — Gemini AI Text & Scanned PDF Summarization
// POST /api/ai/summarize
// Body: { fileId, saveToDrive?, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/summarize', requireAuth, async (req, res) => {
    try {
        const { fileId, saveToDrive, targetFolderId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        const mime = file.mime_type || '';
        const name = (file.original_name || '').toLowerCase();

        let geminiContents = [];
        let originalLength = 0;

        // 1. PDF Document Handling
        if (mime === 'application/pdf' || name.endsWith('.pdf')) {
            const extractedText = await extractPdfText(buffer);
            if (extractedText && extractedText.length >= 50) {
                // Text-based PDF: send truncated text
                originalLength = extractedText.length;
                const truncatedText = extractedText.length > 30000
                    ? extractedText.substring(0, 30000) + '\n\n[... document truncated for summarization ...]'
                    : extractedText;
                geminiContents = [{
                    role: 'user',
                    parts: [{
                        text: `Please provide a comprehensive summary of the following document.
Structure your summary with:
1. **Main Topic** (1-2 sentences)
2. **Key Points** (bullet points)
3. **Conclusion** (1-2 sentences)

Document:
---
${truncatedText}
---

Provide the summary clearly formatted.`
                    }]
                }];
            } else {
                // Scanned / Image-only PDF: send via Multimodal inlineData
                originalLength = buffer.length;
                const base64Pdf = buffer.toString('base64');
                geminiContents = [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                        {
                            text: `Please read this scanned PDF document and provide a comprehensive summary.
Structure your summary with:
1. **Main Topic** (1-2 sentences)
2. **Key Points** (bullet points)
3. **Conclusion** (1-2 sentences)

Provide the summary clearly formatted.`
                        }
                    ]
                }];
            }
        }
        // 2. DOCX Document Handling
        else if (
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            name.endsWith('.docx') ||
            name.endsWith('.doc')
        ) {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            const documentText = (result.value || '').trim();
            if (!documentText || documentText.length < 30) {
                return res.status(400).json({ error: 'The document has too little text to summarize.' });
            }
            originalLength = documentText.length;
            const truncatedText = documentText.length > 30000
                ? documentText.substring(0, 30000) + '\n\n[... document truncated for summarization ...]'
                : documentText;
            geminiContents = [{
                role: 'user',
                parts: [{
                    text: `Please provide a comprehensive summary of the following document.
Structure your summary with:
1. **Main Topic** (1-2 sentences)
2. **Key Points** (bullet points)
3. **Conclusion** (1-2 sentences)

Document:
---
${truncatedText}
---

Provide the summary clearly formatted.`
                }]
            }];
        }
        // 3. Plain Text / Markdown / Code / JSON / CSV
        else if (
            mime.startsWith('text/') ||
            mime === 'application/json' ||
            name.endsWith('.txt') ||
            name.endsWith('.md') ||
            name.endsWith('.csv') ||
            name.endsWith('.json') ||
            name.endsWith('.js') ||
            name.endsWith('.py') ||
            name.endsWith('.html')
        ) {
            const documentText = buffer.toString('utf-8').trim();
            if (!documentText || documentText.length < 20) {
                return res.status(400).json({ error: 'The document has too little text to summarize.' });
            }
            originalLength = documentText.length;
            const truncatedText = documentText.length > 30000
                ? documentText.substring(0, 30000) + '\n\n[... document truncated for summarization ...]'
                : documentText;
            geminiContents = [{
                role: 'user',
                parts: [{
                    text: `Please provide a comprehensive summary of the following document.
Structure your summary with:
1. **Main Topic** (1-2 sentences)
2. **Key Points** (bullet points)
3. **Conclusion** (1-2 sentences)

Document:
---
${truncatedText}
---

Provide the summary clearly formatted.`
                }]
            }];
        }
        // 4. Image Document (Photo of note / receipt / slide / certificate)
        else if (mime.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)) {
            originalLength = buffer.length;
            const base64Img = buffer.toString('base64');
            const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg';
            geminiContents = [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: imgMime, data: base64Img } },
                    {
                        text: `Please read and analyze this document image and provide a comprehensive summary.
Structure your summary with:
1. **Main Topic** (1-2 sentences)
2. **Key Points** (bullet points)
3. **Conclusion** (1-2 sentences)

Provide the summary clearly formatted.`
                    }
                ]
            }];
        }
        else {
            return res.status(400).json({ error: 'Document Summary supports PDF, DOCX, TXT, MD, CSV, and Image files.' });
        }

        // Call Gemini for summarization
        const geminiRes = await callGemini('gemini-3-flash-preview', geminiContents);

        let summary = '';
        try {
            const parts = geminiRes.candidates?.[0]?.content?.parts || [];
            const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
            summary = (textPart && textPart.text ? textPart.text : '').trim();
        } catch (e) {
            return res.status(500).json({ error: 'Unexpected response received during summarization.' });
        }

        if (!summary) {
            return res.status(500).json({ error: 'Could not generate summary for this file.' });
        }

        let savedFile = null;
        if (saveToDrive && summary) {
            const baseName = (file.original_name || 'document').replace(/\.[^.]+$/, '');
            const sumName = `${baseName}-summary.txt`;
            const sumBuffer = Buffer.from(summary, 'utf-8');
            savedFile = await saveBufferToDrive(
                req.session.userId, sumBuffer, sumName, 'text/plain', targetFolderId || null
            );
        }

        res.json({
            success: true,
            summary,
            originalLength,
            savedFile: savedFile ? { id: savedFile.id, name: savedFile.original_name } : null,
            message: saveToDrive && savedFile ? `Summary saved as "${savedFile.original_name}"` : 'Summary generated successfully.'
        });

    } catch (err) {
        console.error('[ai/summarize] error:', err);
        res.status(500).json({ error: err.message || 'Summarization failed' });
    }
});

// ══════════════════════════════════════════════════════════════════
// GET tags for a file
// GET /api/ai/tags/:fileId
// ══════════════════════════════════════════════════════════════════
router.get('/tags/:fileId', requireAuth, async (req, res) => {
    try {
        const { data: file, error } = await supabaseAdmin.from('files')
            .select('tags')
            .eq('id', req.params.fileId)
            .maybeSingle();
        if (error || !file) return res.status(404).json({ error: 'File not found' });

        let tags = [];
        if (file.tags) {
            try { tags = typeof file.tags === 'string' ? JSON.parse(file.tags) : file.tags; } catch(e) {}
        }
        res.json({ tags });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
