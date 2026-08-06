const multer  = require('multer');
const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

function runMiddleware(req, res, fn) {
    return new Promise((resolve, reject) => {
        fn(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            return resolve(result);
        });
    });
}

async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        await runMiddleware(req, res, upload.single('profile_pic'));

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!req.file.mimetype.startsWith('image/'))
            return res.status(400).json({ error: 'Only images allowed' });

        const ext      = req.file.originalname.split('.').pop();
        const fileName = `profile_${userId}_${Date.now()}.${ext}`;

        // Remove old avatar (best-effort)
        const { data: user } = await supabase
            .from('users').select('profile_picture').eq('id', userId).single();
        if (user?.profile_picture) {
            const oldPath = user.profile_picture.split('/avatars/')[1];
            if (oldPath) await supabase.storage.from('avatars').remove([oldPath]);
        }

        // Upload new avatar
        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

        if (uploadError)
            return res.status(500).json({ error: 'Upload failed: ' + uploadError.message });

        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

        // Update DB
        await supabase.from('users').update({ profile_picture: urlData.publicUrl }).eq('id', userId);

        res.json({ success: true, profile_picture: urlData.publicUrl });
    } catch (err) {
        console.error('/profile/picture error:', err);
        res.status(500).json({ error: 'Upload failed' });
    }
}

// config must be on the named function, not after module.exports reassignment
handler.config = { api: { bodyParser: false } };
module.exports = handler;
