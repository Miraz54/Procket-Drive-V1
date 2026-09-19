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
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-flash-latest'
];

async function callGemini(preferredModel, contents) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
        throw new Error('Gemini API Key সেট করা হয়নি! দয়া করে .env ফাইলে আপনার GEMINI_API_KEY দিন। (ফ্রি কী পাবেন: https://aistudio.google.com/app/apikey)');
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
                body: JSON.stringify({ contents })
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
                throw new Error('Gemini API Key টি সঠিক নয় বা ইনভ্যালিড। দয়া করে https://aistudio.google.com/app/apikey থেকে একটি নতুন ও কার্যকর API Key নিয়ে .env ফাইলে দিন।');
            }

            // High demand (503) or Rate Limit (429) or Model unavailable (404) -> Fallback to next model
            if (resp.status === 503 || resp.status === 429 || resp.status === 404) {
                console.warn(`[callGemini] Model ${model} returned ${resp.status} (${errMsg.slice(0, 80)}). Trying fallback model...`);
                lastError = new Error(`Google Gemini (${model}) সাময়িক ব্যস্ত (High Demand)।`);
                if (i < modelsToTry.length - 1) {
                    await new Promise(res => setTimeout(res, 800)); // small delay before next model
                    continue;
                }
            } else {
                throw new Error(`Gemini API error (${resp.status}): ${errMsg}`);
            }
        } catch(netErr) {
            if (netErr.message.includes('API Key টি সঠিক নয়')) throw netErr;
            console.warn(`[callGemini] Exception on model ${model}:`, netErr.message);
            lastError = netErr;
            if (i < modelsToTry.length - 1) {
                await new Promise(res => setTimeout(res, 800));
                continue;
            }
        }
    }

    throw lastError || new Error('Google Gemini সার্ভারে সাময়িক অতিরিক্ত ট্রাফিকের (High Demand) কারণে অনুরোধটি সম্পন্ন করা যায়নি। অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন।');
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
// 2. AI IMAGE EDITOR — Gemini AI Prompt Analysis + Sharp Image Engine
// POST /api/ai/image-edit
// Body: { fileId, prompt, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/image-edit', requireAuth, async (req, res) => {
    try {
        const { fileId, prompt, targetFolderId } = req.body;
        if (!fileId || !prompt) return res.status(400).json({ error: 'fileId and prompt required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        if (!file.mime_type || !file.mime_type.startsWith('image/')) {
            return res.status(400).json({ error: 'Only image files (JPG, PNG, WebP) can be edited.' });
        }

        const sharp = require('sharp');

        // Default editing parameters
        let ops = {
            description: `Applied visual edit: "${prompt}"`,
            grayscale: false,
            sepia: false,
            brightness: 1.0,
            saturation: 1.0,
            contrast: 1.0,
            blur: 0,
            sharpen: false,
            negate: false,
            rotate: 0,
            flip: false,
            flop: false,
            tint: null
        };

        // 1. Call Gemini to analyze the user's natural language edit prompt
        try {
            const geminiRes = await callGemini('gemini-3.6-flash', [
                {
                    role: 'user',
                    parts: [{
                        text: `You are an expert AI image editor. A user wants to edit their image with this prompt: "${prompt}".
Analyze what visual transformations are requested and translate them into image editing parameters.
Respond ONLY with a valid JSON object matching this schema (no markdown, no other text):
{
  "description": "Concise 1 sentence describing what visual changes were made",
  "grayscale": false,
  "sepia": false,
  "brightness": 1.0,
  "saturation": 1.0,
  "contrast": 1.0,
  "blur": 0,
  "sharpen": false,
  "negate": false,
  "rotate": 0,
  "flip": false,
  "flop": false,
  "tint": null
}

Rules:
- "grayscale": true if user asks for black and white, monochrome, b&w, desaturate, etc.
- "sepia": true if user asks for sepia, vintage, retro, 70s, old photo, warm memory, nostalgia.
- "brightness": number between 0.3 (dark/dim) to 2.0 (bright/sunny), default 1.0.
- "saturation": number between 0.0 (faded) to 2.5 (vibrant/pop), default 1.0.
- "contrast": number between 0.6 (flat/soft) to 1.8 (dramatic/punchy), default 1.0.
- "blur": number 0 to 15 (e.g. 4 for soft blur, 10 for strong blur), 0 for none.
- "sharpen": true if user asks for sharp, detailed, clarity, unblur, crisp.
- "negate": true if user asks to invert colors, negative, x-ray.
- "rotate": 0, 90, 180, or 270 degrees if user asks to rotate or turn.
- "flip": true if vertical upside-down flip.
- "flop": true if horizontal mirror / selfie reflection.
- "tint": hex color like "#ff6600", "#00d2ff", "#ffb6c1", or null if no tint/color wash requested.`
                    }]
                }
            ]);

            const parts = geminiRes.candidates[0].content.parts || [];
            const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
            const text = (textPart && textPart.text) || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                ops = Object.assign(ops, parsed);
            }
        } catch (geminiErr) {
            console.warn('[image-edit] Gemini analysis error, applying heuristic fallback:', geminiErr.message);
        }

        // 2. Keyword fallback safety net (ensures accuracy even if AI returned generic JSON)
        const pLower = prompt.toLowerCase();
        if (pLower.includes('black and white') || pLower.includes('b&w') || pLower.includes('monochrome') || pLower.includes('সাদা কালো')) {
            ops.grayscale = true;
        }
        if (pLower.includes('sepia') || pLower.includes('vintage') || pLower.includes('retro') || pLower.includes('ভিンテージ')) {
            ops.sepia = true;
        }
        if (pLower.includes('blur') || pLower.includes('ব্লার')) {
            ops.blur = ops.blur > 0 ? ops.blur : 5;
        }
        if (pLower.includes('invert') || pLower.includes('negative') || pLower.includes('ইনভার্ট')) {
            ops.negate = true;
        }
        if (pLower.includes('bright') || pLower.includes('light') || pLower.includes('উজ্জ্বল')) {
            ops.brightness = Math.max(ops.brightness, 1.3);
        }
        if (pLower.includes('dark') || pLower.includes('moody') || pLower.includes('অন্ধকার')) {
            ops.brightness = Math.min(ops.brightness, 0.7);
        }
        if (pLower.includes('sharp') || pLower.includes('clarity') || pLower.includes('শার্প')) {
            ops.sharpen = true;
        }
        if (pLower.includes('mirror') || pLower.includes('flop') || pLower.includes('আয়না')) {
            ops.flop = true;
        }
        if (pLower.includes('rotate 90') || pLower.includes('ঘুরাও ৯0')) {
            ops.rotate = 90;
        }
        if (pLower.includes('rotate 180')) {
            ops.rotate = 180;
        }

        // 3. Execute pixel transformations using Sharp
        let image = sharp(buffer);

        // Sepia
        if (ops.sepia) {
            image = image.recomb([
                [0.393, 0.769, 0.189],
                [0.349, 0.686, 0.168],
                [0.272, 0.534, 0.131]
            ]);
        }

        // Grayscale
        if (ops.grayscale) {
            image = image.grayscale();
        }

        // Brightness & Saturation
        const b = typeof ops.brightness === 'number' ? Math.max(0.2, Math.min(2.5, ops.brightness)) : 1.0;
        const s = typeof ops.saturation === 'number' ? Math.max(0.0, Math.min(3.0, ops.saturation)) : 1.0;
        if (b !== 1.0 || s !== 1.0) {
            image = image.modulate({ brightness: b, saturation: s });
        }

        // Contrast
        if (typeof ops.contrast === 'number' && ops.contrast !== 1.0) {
            const c = Math.max(0.5, Math.min(2.0, ops.contrast));
            image = image.linear(c, 128 * (1 - c));
        }

        // Tint / Color filter
        if (ops.tint && typeof ops.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(ops.tint)) {
            try { image = image.tint(ops.tint); } catch(e) {}
        }

        // Blur
        if (typeof ops.blur === 'number' && ops.blur > 0) {
            const r = Math.max(0.3, Math.min(25, ops.blur));
            image = image.blur(r);
        }

        // Sharpen
        if (ops.sharpen) {
            image = image.sharpen();
        }

        // Invert / Negate
        if (ops.negate) {
            image = image.negate({ alpha: false });
        }

        // Rotate
        if (ops.rotate && [90, 180, 270].includes(Number(ops.rotate))) {
            image = image.rotate(Number(ops.rotate));
        }

        // Flip / Flop
        if (ops.flip) image = image.flip();
        if (ops.flop) image = image.flop();

        // Render edited image buffer
        const isPng = (file.mime_type === 'image/png');
        const editedBuffer = isPng ? await image.png().toBuffer() : await image.jpeg({ quality: 90 }).toBuffer();
        const outMime = isPng ? 'image/png' : 'image/jpeg';
        const ext = isPng ? 'png' : 'jpg';

        // 4. Save directly into user's Drive folder
        const baseName = (file.original_name || 'image').replace(/\.[^.]+$/, '');
        const newName = `${baseName}-edited.${ext}`;

        const savedFile = await saveBufferToDrive(
            req.session.userId,
            editedBuffer,
            newName,
            outMime,
            targetFolderId || null
        );

        res.json({
            success: true,
            message: `AI edited image saved as "${savedFile.original_name}" in your Drive.`,
            description: ops.description || `Applied visual changes for: "${prompt}"`,
            file: {
                id: savedFile.id,
                name: savedFile.original_name,
                size: savedFile.file_size
            }
        });

    } catch (err) {
        console.error('[ai/image-edit] error:', err);
        res.status(500).json({ error: err.message || 'Image edit failed' });
    }
});

// ══════════════════════════════════════════════════════════════════
// 3. OCR — Tesseract.js text extraction from image/PDF
// POST /api/ai/ocr
// Body: { fileId, saveToDrive?, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/ocr', requireAuth, async (req, res) => {
    try {
        const { fileId, saveToDrive, targetFolderId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        const mime = file.mime_type || '';

        let extractedText = '';

        if (mime.startsWith('image/')) {
            // Use Tesseract.js for image OCR
            const { createWorker } = require('tesseract.js');
            const worker = await createWorker('eng');
            try {
                const { data: { text } } = await worker.recognize(buffer);
                extractedText = text.trim();
            } finally {
                await worker.terminate();
            }
        } else if (mime === 'application/pdf' || file.original_name.toLowerCase().endsWith('.pdf')) {
            // Use extractPdfText helper to extract text from PDF
            extractedText = await extractPdfText(buffer);

            if (!extractedText) {
                return res.status(400).json({ error: 'This PDF appears to be a scanned image PDF. Please use an image-based OCR tool.' });
            }
        } else {
            return res.status(400).json({ error: 'OCR supports image files (JPG, PNG, etc.) and text-based PDFs.' });
        }

        if (!extractedText) {
            return res.json({ success: true, text: '', message: 'No text found in the file.' });
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
// 5. DOCUMENT SUMMARY — Gemini text summarization
// POST /api/ai/summarize
// Body: { fileId, saveToDrive?, targetFolderId? }
// ══════════════════════════════════════════════════════════════════
router.post('/summarize', requireAuth, async (req, res) => {
    try {
        const { fileId, saveToDrive, targetFolderId } = req.body;
        if (!fileId) return res.status(400).json({ error: 'fileId required' });

        const { buffer, file } = await fetchFileBuffer(fileId);
        const mime = file.mime_type || '';
        const name = file.original_name || '';

        let documentText = '';

        // Extract text from PDF
        if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
            documentText = await extractPdfText(buffer);
            if (!documentText) {
                return res.status(400).json({ error: 'Could not extract text from this PDF. It may be a scanned/image PDF.' });
            }
        }
        // Extract text from DOCX
        else if (
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            name.toLowerCase().endsWith('.docx') ||
            name.toLowerCase().endsWith('.doc')
        ) {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            documentText = result.value.trim();
        }
        // Plain text
        else if (mime === 'text/plain' || name.toLowerCase().endsWith('.txt')) {
            documentText = buffer.toString('utf-8').trim();
        }
        else {
            return res.status(400).json({ error: 'Document Summary supports PDF, DOCX, and TXT files.' });
        }

        if (!documentText || documentText.length < 50) {
            return res.status(400).json({ error: 'The document has too little text to summarize.' });
        }

        // Truncate to avoid Gemini token limit (~30,000 chars max)
        const truncatedText = documentText.length > 30000
            ? documentText.substring(0, 30000) + '\n\n[... document truncated for summarization ...]'
            : documentText;

        // Call Gemini for summarization
        const geminiRes = await callGemini('gemini-3.6-flash', [
            {
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
                    
                    Provide the summary in English, clearly formatted.`
                }]
            }
        ]);

        let summary = '';
        try {
            const parts = geminiRes.candidates[0].content.parts || [];
            const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
            summary = (textPart && textPart.text ? textPart.text : '').trim();
        } catch (e) {
            return res.status(500).json({ error: 'Gemini returned unexpected response for summarization.' });
        }

        let savedFile = null;
        if (saveToDrive && summary) {
            const baseName = name.replace(/\.[^.]+$/, '');
            const sumName = `${baseName}-summary.txt`;
            const sumBuffer = Buffer.from(summary, 'utf-8');
            savedFile = await saveBufferToDrive(
                req.session.userId, sumBuffer, sumName, 'text/plain', targetFolderId || null
            );
        }

        res.json({
            success: true,
            summary,
            originalLength: documentText.length,
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
