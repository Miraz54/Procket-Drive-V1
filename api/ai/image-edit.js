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
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
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

    // Sample top perimeter & corners only (avoid bottom edge and center where subjects sit)
    const sampleCoords = [
        [0, 0], [width - 1, 0],
        [Math.floor(width * 0.2), 0], [Math.floor(width * 0.8), 0],
        [0, Math.floor(height * 0.1)], [width - 1, Math.floor(height * 0.1)]
    ];

    const bgColors = [];
    for (const [sx, sy] of sampleCoords) {
        const p = getPixel(sx, sy);
        if (!bgColors.some(c => Math.abs(c[0] - p[0]) < 18 && Math.abs(c[1] - p[1]) < 18 && Math.abs(c[2] - p[2]) < 18)) {
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

    // Subject core bounding box: protect subject head, body and torso from flood-fill
    const coreXMin = Math.floor(width * 0.20);
    const coreXMax = Math.floor(width * 0.80);
    const coreYMin = Math.floor(height * 0.05); // Protects human head from y=0.05 downwards
    const coreYMax = Math.floor(height * 0.92);

    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    // Seed ONLY from top corners (avoid top center where hair/head is)
    const cornerLimitX = Math.floor(width * 0.20);
    for (let x = 0; x < cornerLimitX; x++) {
        // top-left
        const pTL = getPixel(x, 0);
        if (isBgColor(pTL[0], pTL[1], pTL[2])) { visited[x] = 1; queue[tail++] = x; }
        // top-right
        const xr = width - 1 - x;
        const pTR = getPixel(xr, 0);
        if (isBgColor(pTR[0], pTR[1], pTR[2])) { visited[xr] = 1; queue[tail++] = xr; }
    }

    const seedHeight = Math.floor(height * 0.40);
    for (let y = 1; y < seedHeight; y++) {
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

        const neighbors = [
            cx > 0 ? curIdx - 1 : -1,
            cx < width - 1 ? curIdx + 1 : -1,
            cy > 0 ? curIdx - width : -1,
            cy < height - 1 ? curIdx + width : -1
        ];

        for (const n of neighbors) {
            if (n === -1 || visited[n]) continue;
            const nx = n % width;
            const ny = Math.floor(n / width);

            // Block entering the core subject area
            if (nx >= coreXMin && nx <= coreXMax && ny >= coreYMin && ny <= coreYMax) {
                continue;
            }

            const p = getPixel(nx, ny);
            if (isBgColor(p[0], p[1], p[2])) {
                visited[n] = 1;
                queue[tail++] = n;
            }
        }
    }

    // 2. Build 8-bit Alpha Mask buffer (0 for background, 255 for foreground)
    const maskBuffer = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
        maskBuffer[i] = visited[i] ? 0 : 255;
    }

    // 3. Smooth the mask using Gaussian Blur (2.0 radius) for silky anti-aliased edge feathering
    const smoothedMask = await sharp(maskBuffer, { raw: { width, height, channels: 1 } })
        .blur(2.0)
        .raw()
        .toBuffer();

    // 4. Combine RGB from original image with smoothed alpha channel
    const rgbData = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        rgbData[i * 3]     = data[i * channels];
        rgbData[i * 3 + 1] = data[i * channels + 1];
        rgbData[i * 3 + 2] = data[i * channels + 2];
    }

    const rgbImage = sharp(rgbData, { raw: { width, height, channels: 3 } });
    const finalPng = await rgbImage
        .joinChannel(smoothedMask, { raw: { width, height, channels: 1 } })
        .png({ compressionLevel: 8 })
        .toBuffer();

    return {
        buffer: finalPng,
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
            blur_background: false,
            style: null, // 'sketch' | 'cartoon' | 'cyberpunk' | 'vintage' | 'hdr' | 'oil_painting' | 'cinematic' | 'noir'
            vibe: 'none', // 'warm' | 'cool' | 'moody' | 'none'
            beautify: false,
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
                        text: `You are an expert AI photo editor. The user wants to edit an image with this prompt (which may be in Bengali, Banglish, or English): "${prompt}".
Analyze what visual transformations are requested and translate them into image editing parameters.
Respond ONLY with a valid JSON object matching this schema (no markdown, no thought, no explanation):
{
  "description": "Concise 1 sentence describing what visual changes were made",
  "remove_background": false,
  "background_color": null,
  "blur_background": false,
  "style": null,
  "vibe": "none",
  "beautify": false,
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
- "remove_background": true if user asks to remove background, transparent background, isolate subject, cutout, etc.
- "background_color": hex color (e.g. "#000000" for black, "#ffffff" for white, "#ff0000" for red) if user wants to change/replace background with a specific color.
- "blur_background": true if user asks for portrait mode / bokeh / blur background.
- "style": "oil_painting" (oil painting / fine art / canvas), "cinematic" (movie teal-orange / dramatic film look), "sketch" (pencil drawing/sketch), "cartoon" (comic/anime), "cyberpunk" (neon glow), "vintage" (retro 70s), "hdr" (vibrant pop), "noir" (dramatic black and white), or null.
- "vibe": "warm" (golden hour / sunset / warm glow), "cool" (matrix / blue chill / winter), "moody" (deep dramatic shadows), or "none".
- "beautify": true if user asks to make face/photo beautiful, clear, clean skin, handsome, bright face, glow.
- "grayscale": true for black and white, monochrome, b&w, desaturate.
- "sepia": true for vintage sepia tone.
- "brightness": number 0.3 to 2.2 (default 1.0).
- "saturation": number 0.0 to 2.5 (default 1.0).
- "contrast": number 0.6 to 2.0 (default 1.0).
- "blur": number 0 to 15 (0 for none).
- "sharpen": true if asked to sharpen, unblur, crisp, detail.
- "negate": true if asked to invert, negative, x-ray.
- "rotate": 0, 90, 180, 270.
- "flip": vertical upside-down flip.
- "flop": horizontal mirror reflection.
- "tint": hex color like "#ff6600", "#00d2ff", or null.`
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

        // Background removal & replacement
        if (pLower.includes('remove background') || pLower.includes('background remove') || pLower.includes('remove bg') ||
            pLower.includes('transparent') || pLower.includes('cutout') || pLower.includes('cut out') ||
            pLower.includes('ব্যাকগ্রাউন্ড রিমুভ') || pLower.includes('ব্যাকগ্রাউন্ড সরাও') || pLower.includes('ব্যাকগ্রাউন্ড ডিলিট') ||
            pLower.includes('সাদা ব্যাকগ্রাউন্ড সরাও') || pLower.includes('no background')) {
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
            if (pLower.includes(ck.k + ' background') || pLower.includes('background ' + ck.k) || pLower.includes('ব্যাকগ্রাউন্ড ' + ck.k) ||
                pLower.includes('background to ' + ck.k) || pLower.includes('bg ' + ck.k)) {
                ops.remove_background = true;
                ops.background_color = ck.hex;
                break;
            }
        }

        // Styles & Artistic Effects
        if (pLower.includes('oil') || pLower.includes('painting') || pLower.includes('paint') || pLower.includes('পেইন্টিং') || pLower.includes('তৈলচিত্র') || pLower.includes('চিত্র') || pLower.includes('আঁকা')) {
            ops.style = 'oil_painting';
        } else if (pLower.includes('cinematic') || pLower.includes('movie') || pLower.includes('film') || pLower.includes('teal orange') || pLower.includes('সিনেমাটিক') || pLower.includes('ফিল্মি')) {
            ops.style = 'cinematic';
        } else if (pLower.includes('sketch') || pLower.includes('pencil') || pLower.includes('drawing') || pLower.includes('স্কেচ') || pLower.includes('ড্রয়িং')) {
            ops.style = 'sketch';
        } else if (pLower.includes('cartoon') || pLower.includes('comic') || pLower.includes('anime') || pLower.includes('কার্টুন') || pLower.includes('কমিক')) {
            ops.style = 'cartoon';
        } else if (pLower.includes('cyberpunk') || pLower.includes('neon') || pLower.includes('sci-fi') || pLower.includes('নিয়ন') || pLower.includes('সাইবার')) {
            ops.style = 'cyberpunk';
        } else if (pLower.includes('hdr') || pLower.includes('vibrant') || pLower.includes('pop') || pLower.includes('কালারফুল') || pLower.includes('রঙিন')) {
            ops.style = 'hdr';
        } else if (pLower.includes('vintage') || pLower.includes('retro') || pLower.includes('sepia') || pLower.includes('ভিন্টেজ') || pLower.includes('সেপিয়া')) {
            ops.style = 'vintage';
            ops.sepia = true;
        }

        // Atmosphere / Vibe
        if (pLower.includes('sunset') || pLower.includes('golden hour') || pLower.includes('warm') || pLower.includes('সূর্যাস্ত') || pLower.includes('ওয়ার্ম') || pLower.includes('সানসেট') || pLower.includes('সোনালী')) {
            ops.vibe = 'warm';
        } else if (pLower.includes('cool') || pLower.includes('cold') || pLower.includes('matrix') || pLower.includes('ice') || pLower.includes('বরফ') || pLower.includes('কোল্ড') || pLower.includes('নীল ভাব')) {
            ops.vibe = 'cool';
        } else if (pLower.includes('moody') || pLower.includes('মুডি')) {
            ops.vibe = 'moody';
        }

        // Beautify & Clarity
        if (pLower.includes('beauty') || pLower.includes('beautiful') || pLower.includes('handsome') || pLower.includes('clean face') || pLower.includes('glow') ||
            pLower.includes('সুন্দর') || pLower.includes('ফর্সা') || pLower.includes('পরিষ্কার') || pLower.includes('উজ্জ্বল করো') || pLower.includes('ভালো করো')) {
            ops.beautify = true;
        }

        // Filters
        if (pLower.includes('black and white') || pLower.includes('b&w') || pLower.includes('monochrome') || pLower.includes('সাদা কালো') || pLower.includes('সাদাকালো')) {
            ops.grayscale = true;
            ops.contrast = Math.max(ops.contrast, 1.3);
        }
        if (pLower.includes('blur') || pLower.includes('ব্লার')) {
            ops.blur = ops.blur > 0 ? ops.blur : 6;
        }
        if (pLower.includes('invert') || pLower.includes('negative') || pLower.includes('ইনভার্ট')) {
            ops.negate = true;
        }
        if (pLower.includes('bright') || pLower.includes('light') || pLower.includes('উজ্জ্বল')) {
            ops.brightness = Math.max(ops.brightness, 1.35);
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
        if (pLower.includes('rotate 90') || pLower.includes('ঘুরাও ৯০') || pLower.includes('ঘুরাও ৯0')) {
            ops.rotate = 90;
        }
        if (pLower.includes('rotate 180')) {
            ops.rotate = 180;
        }

        // Guarantee visible change: if everything is default, apply creative visual enhancement
        const hasCustomAction = ops.remove_background || ops.background_color || ops.blur_background ||
            ops.style || ops.vibe !== 'none' || ops.beautify || ops.grayscale || ops.sepia ||
            ops.brightness !== 1.0 || ops.saturation !== 1.0 || ops.contrast !== 1.0 ||
            ops.blur > 0 || ops.sharpen || ops.negate || ops.rotate !== 0 ||
            ops.flip || ops.flop || ops.tint;

        if (!hasCustomAction) {
            ops.contrast = 1.35;
            ops.saturation = 1.45;
            ops.brightness = 1.08;
            ops.sharpen = true;
            ops.description = `Applied creative visual enhancement & vibrant clarity pop for: "${prompt}"`;
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

        if (ops.style === 'oil_painting') {
            workingBuffer = await sharp(workingBuffer)
                .median(3)
                .modulate({ saturation: 1.4, brightness: 1.05 })
                .linear(1.15, -10)
                .sharpen()
                .toBuffer();
            ops.description = `Rich oil painting canvas art style applied.`;
        } else if (ops.style === 'cinematic') {
            workingBuffer = await sharp(workingBuffer)
                .recomb([
                    [1.15, -0.05, -0.1],
                    [-0.05, 1.05, 0.0],
                    [-0.15, 0.05, 1.2]
                ])
                .modulate({ saturation: 1.35, brightness: 1.02 })
                .linear(1.2, -15)
                .toBuffer();
            ops.description = `Moody cinematic teal & orange film look applied.`;
        } else if (ops.style === 'sketch') {
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
        } else if (ops.style === 'noir') {
            workingBuffer = await sharp(workingBuffer)
                .grayscale()
                .linear(1.45, -35)
                .toBuffer();
            ops.description = `High-contrast noir film monochrome applied.`;
        }

        // Atmosphere / Vibe Modulations
        if (ops.vibe === 'warm') {
            workingBuffer = await sharp(workingBuffer)
                .recomb([
                    [1.25, 0.05, -0.1],
                    [0.1, 1.1, -0.1],
                    [-0.1, -0.1, 0.8]
                ])
                .modulate({ saturation: 1.4, brightness: 1.1 })
                .linear(1.15, -10)
                .toBuffer();
            ops.description = ops.description || `Golden hour warm sunset aesthetic applied.`;
        } else if (ops.vibe === 'cool') {
            workingBuffer = await sharp(workingBuffer)
                .recomb([
                    [0.85, 0.0, 0.1],
                    [0.0, 1.05, 0.1],
                    [0.05, 0.1, 1.3]
                ])
                .modulate({ saturation: 1.2, brightness: 1.02 })
                .linear(1.15, -10)
                .toBuffer();
            ops.description = ops.description || `Cool matrix blue-tint aesthetic applied.`;
        } else if (ops.vibe === 'moody') {
            workingBuffer = await sharp(workingBuffer)
                .modulate({ saturation: 0.9, brightness: 0.85 })
                .linear(1.4, -30)
                .toBuffer();
            ops.description = ops.description || `Moody atmospheric shadows look applied.`;
        }

        // Beauty & Clarity Enhance
        if (ops.beautify) {
            workingBuffer = await sharp(workingBuffer)
                .modulate({ brightness: 1.12, saturation: 1.15 })
                .linear(1.12, -8)
                .sharpen()
                .toBuffer();
            ops.description = ops.description || `Studio beauty clarity, illumination and face glow applied.`;
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
