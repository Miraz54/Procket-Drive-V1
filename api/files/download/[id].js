const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Helper to check if a user has access (owner or shared) to a folder
async function checkFolderAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) return true; // Fallback: allow

        if (String(folder.user_id).trim() === String(userId).trim()) return true;

        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) return true;
        const userEmail = user.email.toLowerCase().trim();

        // Check folder_shares table
        const { data: share } = await supabaseAdmin.from('folder_shares')
            .select('id')
            .eq('folder_id', folderId)
            .eq('shared_with_email', userEmail)
            .maybeSingle();

        if (share) return true;

        if (folder.shared_emails) {
            try {
                const emails = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(emails)) {
                    for (const entry of emails) {
                        if (typeof entry === 'object' && entry !== null) {
                            if (String(entry.email).toLowerCase().trim() === userEmail) {
                                return true;
                            }
                        } else if (typeof entry === 'string') {
                            if (entry.toLowerCase().trim() === userEmail) {
                                return true;
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        return false;
    } catch(err) {
        console.error('[checkFolderAccess] catch error:', err);
        return true;
    }
}

// GET /api/files/download/[id]
// Forces file download as attachment
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;

    try {
        const { data: file, error } = await supabaseAdmin
            .from('files')
            .select('file_path, original_name, mime_type, user_id, folder_id')
            .eq('id', id)
            .eq('is_deleted', 0)
            .maybeSingle();

        if (error || !file) return res.status(404).json({ error: 'File not found' });

        // Check ownership or shared access
        const isOwner = String(file.user_id) === String(userId);
        if (!isOwner && file.folder_id) {
            const hasAccess = await checkFolderAccess(userId, file.folder_id);
            if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
        } else if (!isOwner) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Extract storage relative path
        const parts = file.file_path.split('/userfiles/');
        if (parts.length < 2) return res.status(500).json({ error: 'Invalid file path' });
        const storagePath = parts[1];

        const { data, error: downloadError } = await supabaseAdmin.storage
            .from('userfiles')
            .download(storagePath);

        if (downloadError) return res.status(500).json({ error: 'Download failed' });

        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        console.error('/files/download error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
