const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const sharp = require('sharp');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie, Authorization');
}

const GEMINI_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-flash-latest'
];

async function callGemini(contents) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    for (const model of GEMINI_MODELS) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents })
            });
            if (resp.ok) return await resp.json();
        } catch(e) {
            console.warn(`[api/ai/image-edit] Gemini ${model} error:`, e.message);
        }
    }
    return null;
}

// Smart Adaptive Background Removal
async function removeBackgroundSmart(inputBuffer, options = {}) {
    const tolerance = options.tolerance || 35;
    const feather = options.feather !== false;

    const img = sharp(inputBuffer).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const getPixel = (x, y) => {
        const idx = (y * width + x) * channels;
        return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    };

    const sampleCoords = [
        [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
        [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],
        [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)],
        [Math.floor(width / 4), 0], [Math.floor(3 * width / 4), 0],
        [0, Math.floor(height / 4)], [0, Math.floor(3 * height / 4)],
        [width - 1, Math.floor(height / 4)], [width - 1, Math.floor(3 * height / 4)],
        [Math.floor(width / 4), height - 1], [Math.floor(3 * width / 4), height - 1]
    ];

    const bgColors = [];
    for (const [sx, sy] of sampleCoords) {
        const p = getPixel(sx, sy);
        if (!bgColors.some(c => Math.abs(c[0] - p[0]) < 15 && Math.abs(c[1] - p[1]) < 15 && Math.abs(c[2] - p[2]) < 15)) {
            bgColors.push(p);
        }
    }

    const colorDist = (r1, g1, b1, r2, g2, b2) => {
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
    };

    const isBgColor = (r, g, b) => {
        for (const bg of bgColors) {
            if (colorDist(r, g, b, bg[0], bg[1], bg[2]) <= tolerance) {
                return true;
            }
        }
        return false;
    };

    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    for (let x = 0; x < width; x++) {
        const idxTop = x;
        const pTop = getPixel(x, 0);
        if (isBgColor(pTop[0], pTop[1], pTop[2])) {
            visited[idxTop] = 1;
            queue[tail++] = idxTop;
        }
        const idxBot = (height - 1) * width + x;
        const pBot = getPixel(x, height - 1);
        if (isBgColor(pBot[0], pBot[1], pBot[2])) {
            visited[idxBot] = 1;
            queue[tail++] = idxBot;
        }
    }

    for (let y = 1; y < height - 1; y++) {
        const idxLeft = y * width;
        const pLeft = getPixel(0, y);
        if (!visited[idxLeft] && isBgColor(pLeft[0], pLeft[1], pLeft[2])) {
            visited[idxLeft] = 1;
            queue[tail++] = idxLeft;
        }
        const idxRight = y * width + (width - 1);
        const pRight = getPixel(width - 1, y);
        if (!visited[idxRight] && isBgColor(pRight[0], pRight[1], pRight[2])) {
            visited[idxRight] = 1;
            queue[tail++] = idxRight;
        }
    }

    while (head < tail) {
        const curIdx = queue[head++];
        const cx = curIdx % width;
        const cy = Math.floor(curIdx / width);

        if (cx > 0) {
            const nIdx = curIdx - 1;
            if (!visited[nIdx]) {
                const p = getPixel(cx - 1, cy);
                if (isBgColor(p[0], p[1], p[2])) {
                    visited[nIdx] = 1;
                    queue[tail++] = nIdx;
                }
            }
        }
        if (cx < width - 1) {
            const nIdx = curIdx + 1;
            if (!visited[nIdx]) {
                const p = getPixel(cx + 1, cy);
                if (isBgColor(p[0], p[1], p[2])) {
                    visited[nIdx] = 1;
                    queue[tail++] = nIdx;
                }
            }
        }
        if (cy > 0) {
            const nIdx = curIdx - width;
            if (!visited[nIdx]) {
                const p = getPixel(cx, cy - 1);
                if (isBgColor(p[0], p[1], p[2])) {
                    visited[nIdx] = 1;
                    queue[tail++] = nIdx;
                }
            }
        }
        if (cy < height - 1) {
            const nIdx = curIdx + width;
            if (!visited[nIdx]) {
                const p = getPixel(cx, cy + 1);
                if (isBgColor(p[0], p[1], p[2])) {
                    visited[nIdx] = 1;
                    queue[tail++] = nIdx;
                }
            }
        }
    }

    let visitedCount = 0;
    for (let i = 0; i < width * height; i++) {
        if (visited[i]) visitedCount++;
    }

    if (visitedCount < (width * height * 0.04)) {
        for (let i = 0; i < width * height; i++) {
            const r = data[i * channels];
            const g = data[i * channels + 1];
            const b = data[i * channels + 2];
            if (isBgColor(r, g, b)) {
                visited[i] = 1;
            }
        }
    }

    for (let i = 0; i < width * height; i++) {
        if (visited[i]) {
            data[i * channels + 3] = 0;
        }
    }

    if (feather) {
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                if (!visited[i]) {
                    const nVisited = visited[i - 1] + visited[i + 1] + visited[i - width] + visited[i + width];
                    if (nVisited > 0) {
                        data[i * channels + 3] = Math.max(70, 255 - nVisited * 46);
                    }
                }
            }
        }
    }

    return {
        buffer: await sharp(data, { raw: { width, height, channels } }).png().toBuffer(),
        width,
        height
    };
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) {}
        }
        const { fileId, prompt, targetFolderId } = body || {};
        if (!fileId || !prompt) return res.status(400).json({ error: 'fileId and prompt required' });

        // Fetch file record
        const { data: file, error: fetchErr } = await supabaseAdmin
            .from('files')
            .select('id, user_id, original_name, file_path, mime_type, file_size')
            .eq('id', fileId)
            .eq('is_deleted', 0)
            .maybeSingle();

        if (fetchErr || !file) return res.status(404).json({ error: 'File not found' });
        if (!file.mime_type || !file.mime_type.startsWith('image/')) {
            return res.status(400).json({ error: 'Only image files (JPG, PNG, WebP) can be edited.' });
        }

        // Download image buffer
        const storagePath = file.file_path.split('/userfiles/')[1];
        if (!storagePath) return res.status(400).json({ error: 'Invalid storage path' });

        const { data: downloadData, error: dlErr } = await supabaseAdmin.storage.from('userfiles').download(storagePath);
        if (dlErr || !downloadData) return res.status(500).json({ error: 'Failed to download original image' });

        const buffer = Buffer.from(await downloadData.arrayBuffer());

        let ops = {
            description: `Applied visual edit: "${prompt}"`,
            remove_background: false,
            background_color: null,
            style: null,
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

        // 1. Call Gemini to analyze prompt
        try {
            const geminiRes = await callGemini([
                {
                    role: 'user',
                    parts: [{
                        text: `You are an expert AI image editor. A user wants to edit an image with this prompt: "${prompt}".
Analyze what visual transformations are requested and translate them into image editing parameters.
Respond ONLY with a valid JSON object matching this schema:
{
  "description": "Concise 1 sentence describing what visual changes were made",
  "remove_background": false,
  "background_color": null,
  "style": null,
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
}`
                    }]
                }
            ]);

            const parts = geminiRes?.candidates?.[0]?.content?.parts || [];
            const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text) || parts[0];
            const text = (textPart && textPart.text) || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                ops = Object.assign(ops, parsed);
            }
        } catch(e) {}

        // 2. Keyword fallback safety net
        const pLower = prompt.toLowerCase();

        if (pLower.includes('remove background') || pLower.includes('background remove') || pLower.includes('remove bg') ||
            pLower.includes('transparent') || pLower.includes('cutout') || pLower.includes('cut out') ||
            pLower.includes('ব্যাকগ্রাউন্ড রিমুভ') || pLower.includes('ব্যাকগ্রাউন্ড সরাও') || pLower.includes('no background')) {
            ops.remove_background = true;
        }

        const colorKeywords = [
            { k: 'red', hex: '#ff0000' }, { k: 'লাল', hex: '#ff0000' },
            { k: 'white', hex: '#ffffff' }, { k: 'সাদা', hex: '#ffffff' },
            { k: 'black', hex: '#000000' }, { k: 'কালো', hex: '#000000' },
            { k: 'blue', hex: '#0066ff' }, { k: 'নীল', hex: '#0066ff' },
            { k: 'green', hex: '#00cc44' }, { k: 'সবুজ', hex: '#00cc44' },
            { k: 'yellow', hex: '#ffdd00' }, { k: 'হলুদ', hex: '#ffdd00' },
            { k: 'purple', hex: '#8800ff' }, { k: 'বেগুনি', hex: '#8800ff' },
            { k: 'pink', hex: '#ff66aa' }, { k: 'গোলাপি', hex: '#ff66aa' },
            { k: 'orange', hex: '#ff8800' }, { k: 'কমলা', hex: '#ff8800' }
        ];

        for (const ck of colorKeywords) {
            if (pLower.includes(ck.k + ' background') || pLower.includes('background ' + ck.k) || pLower.includes('ব্যাকগ্রাউন্ড ' + ck.k)) {
                ops.remove_background = true;
                ops.background_color = ck.hex;
                break;
            }
        }

        if (pLower.includes('sketch') || pLower.includes('pencil') || pLower.includes('drawing') || pLower.includes('স্কেচ')) {
            ops.style = 'sketch';
        } else if (pLower.includes('cartoon') || pLower.includes('comic') || pLower.includes('anime') || pLower.includes('কার্টুন')) {
            ops.style = 'cartoon';
        } else if (pLower.includes('cyberpunk') || pLower.includes('neon') || pLower.includes('sci-fi')) {
            ops.style = 'cyberpunk';
        } else if (pLower.includes('hdr') || pLower.includes('vibrant') || pLower.includes('pop')) {
            ops.style = 'hdr';
        } else if (pLower.includes('vintage') || pLower.includes('retro') || pLower.includes('sepia')) {
            ops.style = 'vintage';
            ops.sepia = true;
        }

        if (pLower.includes('black and white') || pLower.includes('b&w') || pLower.includes('monochrome') || pLower.includes('সাদা কালো')) {
            ops.grayscale = true;
        }
        if (pLower.includes('blur') || pLower.includes('ব্লার')) {
            ops.blur = ops.blur > 0 ? ops.blur : 6;
        }
        if (pLower.includes('invert') || pLower.includes('negative')) {
            ops.negate = true;
        }
        if (pLower.includes('bright') || pLower.includes('light')) {
            ops.brightness = Math.max(ops.brightness, 1.35);
        }
        if (pLower.includes('dark') || pLower.includes('moody')) {
            ops.brightness = Math.min(ops.brightness, 0.7);
        }
        if (pLower.includes('sharp') || pLower.includes('clarity')) {
            ops.sharpen = true;
        }
        if (pLower.includes('mirror') || pLower.includes('flop')) {
            ops.flop = true;
        }
        if (pLower.includes('rotate 90')) {
            ops.rotate = 90;
        }
        if (pLower.includes('rotate 180')) {
            ops.rotate = 180;
        }

        const hasCustomAction = ops.remove_background || ops.style || ops.grayscale || ops.sepia ||
            ops.brightness !== 1.0 || ops.saturation !== 1.0 || ops.contrast !== 1.0 ||
            ops.blur > 0 || ops.sharpen || ops.negate || ops.rotate !== 0 ||
            ops.flip || ops.flop || ops.tint;

        if (!hasCustomAction) {
            ops.contrast = 1.2;
            ops.saturation = 1.3;
            ops.sharpen = true;
            ops.description = `Auto-enhanced clarity, contrast and vibrant color balance for: "${prompt}"`;
        }

        // 3. Apply transformations
        let workingBuffer = buffer;
        let outMime = file.mime_type || 'image/jpeg';
        let ext = outMime.includes('png') ? 'png' : 'jpg';

        if (ops.remove_background) {
            const bgResult = await removeBackgroundSmart(workingBuffer);
            if (ops.background_color) {
                const bgCanvas = await sharp({
                    create: {
                        width: bgResult.width,
                        height: bgResult.height,
                        channels: 4,
                        background: ops.background_color
                    }
                }).png().toBuffer();

                workingBuffer = await sharp(bgCanvas)
                    .composite([{ input: bgResult.buffer }])
                    .png()
                    .toBuffer();
                ops.description = `Background replaced with solid color (${ops.background_color}).`;
            } else {
                workingBuffer = bgResult.buffer;
                outMime = 'image/png';
                ext = 'png';
                ops.description = `Background removed and subject isolated with transparent background.`;
            }
        }

        if (ops.style === 'sketch') {
            const g = await sharp(workingBuffer).grayscale().toBuffer();
            const inv = await sharp(g).negate().blur(4).toBuffer();
            workingBuffer = await sharp(g)
                .composite([{ input: inv, blend: 'colour-dodge' }])
                .linear(1.2, -10)
                .toBuffer();
            ops.description = `Hand-drawn pencil sketch style applied.`;
        } else if (ops.style === 'cartoon') {
            workingBuffer = await sharp(workingBuffer)
                .modulate({ saturation: 1.7, brightness: 1.05 })
                .linear(1.25, -20)
                .sharpen()
                .toBuffer();
            ops.description = `Vibrant cartoon/comic style applied.`;
        } else if (ops.style === 'cyberpunk') {
            workingBuffer = await sharp(workingBuffer)
                .modulate({ saturation: 1.85, brightness: 0.9 })
                .linear(1.3, -25)
                .tint('#00f0ff')
                .toBuffer();
            ops.description = `Cyberpunk neon glow aesthetic applied.`;
        } else if (ops.style === 'vintage' || ops.sepia) {
            workingBuffer = await sharp(workingBuffer)
                .recomb([
                    [0.393, 0.769, 0.189],
                    [0.349, 0.686, 0.168],
                    [0.272, 0.534, 0.131]
                ])
                .modulate({ brightness: 1.05, saturation: 1.1 })
                .toBuffer();
            ops.description = `Vintage retro sepia tone applied.`;
        } else if (ops.style === 'hdr') {
            workingBuffer = await sharp(workingBuffer)
                .modulate({ saturation: 1.6, brightness: 1.08 })
                .linear(1.25, -20)
                .sharpen()
                .toBuffer();
            ops.description = `High dynamic range (HDR) vibrant pop applied.`;
        }

        let image = sharp(workingBuffer);

        if (ops.grayscale) {
            image = image.grayscale();
        }

        const b = typeof ops.brightness === 'number' ? Math.max(0.2, Math.min(2.5, ops.brightness)) : 1.0;
        const s = typeof ops.saturation === 'number' ? Math.max(0.0, Math.min(3.0, ops.saturation)) : 1.0;
        if (b !== 1.0 || s !== 1.0) {
            image = image.modulate({ brightness: b, saturation: s });
        }

        if (typeof ops.contrast === 'number' && ops.contrast !== 1.0) {
            const c = Math.max(0.5, Math.min(2.0, ops.contrast));
            image = image.linear(c, 128 * (1 - c));
        }

        if (ops.tint && typeof ops.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(ops.tint)) {
            try { image = image.tint(ops.tint); } catch(e) {}
        }

        if (typeof ops.blur === 'number' && ops.blur > 0) {
            const r = Math.max(0.3, Math.min(25, ops.blur));
            image = image.blur(r);
        }

        if (ops.sharpen) {
            image = image.sharpen();
        }

        if (ops.negate) {
            image = image.negate({ alpha: false });
        }

        if (ops.rotate && [90, 180, 270].includes(Number(ops.rotate))) {
            image = image.rotate(Number(ops.rotate));
        }

        if (ops.flip) image = image.flip();
        if (ops.flop) image = image.flop();

        let editedBuffer;
        if (outMime === 'image/png' || ops.remove_background) {
            editedBuffer = await image.png().toBuffer();
            outMime = 'image/png';
            ext = 'png';
        } else {
            editedBuffer = await image.jpeg({ quality: 90 }).toBuffer();
            outMime = 'image/jpeg';
            ext = 'jpg';
        }

        // Save to Supabase Storage and DB
        const baseName = (file.original_name || 'image').replace(/\.[^.]+$/, '');
        const suffix = ops.remove_background ? 'no-bg' : (ops.style || 'edited');
        const finalName = `${baseName}-${suffix}.${ext}`;
        const safeName = `${Date.now()}-${finalName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const uploadPath = `${userId}/${safeName}`;

        const { error: upErr } = await supabaseAdmin.storage
            .from('userfiles')
            .upload(uploadPath, editedBuffer, { contentType: outMime });

        if (upErr) {
            console.error('[api/ai/image-edit] upload error:', upErr);
            return res.status(500).json({ error: 'Storage upload failed: ' + upErr.message });
        }

        const { data: urlData } = supabaseAdmin.storage.from('userfiles').getPublicUrl(uploadPath);

        const { data: inserted, error: dbError } = await supabaseAdmin.from('files').insert([{
            user_id: userId,
            original_name: finalName,
            file_path: urlData.publicUrl,
            file_size: editedBuffer.length,
            mime_type: outMime,
            folder_id: targetFolderId || null,
            is_deleted: 0
        }]).select();

        if (dbError) {
            console.error('[api/ai/image-edit] DB error:', dbError);
            return res.status(500).json({ error: 'DB insert failed: ' + dbError.message });
        }

        const savedFile = inserted[0];

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

    } catch(err) {
        console.error('[api/ai/image-edit] error:', err);
        res.status(500).json({ error: err.message || 'Image edit failed' });
    }
};
