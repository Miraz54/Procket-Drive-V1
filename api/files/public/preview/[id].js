const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const supabase = require('../../../../lib/supabase');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

const JWT_SECRET = process.env.JWT_SECRET || 'ProcketDrive2024!SecretKey#xyz789';

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Share-Password');
}

// GET /api/files/public/preview/[id]
// Public endpoint - streams file content inline for shared link preview
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { id, st, pwd } = req.query;
    const headerPwd = req.headers['x-share-password'];
    const enteredPassword = pwd || headerPwd;

    if (!st) {
        return res.status(401).json({ error: 'Share token is required to preview this public file' });
    }

    try {
        const payload = jwt.verify(st, JWT_SECRET);
        if (payload.ph) {
            if (!enteredPassword) {
                return res.status(401).json({ error: 'Password required' });
            }
            const hash = crypto.createHash('sha256').update(String(enteredPassword).trim()).digest('hex');
            if (hash !== payload.ph) {
                return res.status(401).json({ error: 'Incorrect password' });
            }
        }
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(410).json({ error: 'This share link has expired and self-destructed.' });
        }
        return res.status(400).json({ error: 'Invalid or corrupted share link' });
    }

    try {
        const { data: file, error } = await supabaseAdmin
            .from('files')
            .select('file_path, original_name, mime_type, folder_id')
            .eq('id', id)
            .eq('is_deleted', 0)
            .maybeSingle();

        if (error || !file) return res.status(404).json({ error: 'File not found' });

        // Never allow public preview of vault files
        if (file.folder_id) {
            const { data: folder } = await supabaseAdmin.from('folders')
                .select('name')
                .eq('id', file.folder_id)
                .maybeSingle();
            if (folder && folder.name === '__pd_vault__') {
                return res.status(403).json({ error: 'Vault files cannot be accessed via public links' });
            }
        }

        const parts = file.file_path.split('/userfiles/');
        if (parts.length < 2) return res.status(500).json({ error: 'Invalid file path' });
        const storagePath = parts.slice(1).join('/userfiles/');

        const { data, error: downloadError } = await supabaseAdmin.storage
            .from('userfiles')
            .download(storagePath);

        if (downloadError) return res.status(500).json({ error: 'Download failed' });

        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        console.error('/api/files/public/preview error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
