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
    res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Helper to check if a user has EDITOR/WRITE access to a folder
async function checkFolderUploadAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) return true;

        if (String(folder.user_id).trim() === String(userId).trim()) return true;

        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) return false;
        const userEmail = user.email.toLowerCase().trim();

        // 1. Check folder_shares table
        const { data: share } = await supabaseAdmin.from('folder_shares')
            .select('role')
            .eq('folder_id', folderId)
            .eq('shared_with_email', userEmail)
            .maybeSingle();

        if (share) return share.role === 'editor';

        // 2. Check folders.shared_emails JSON
        if (folder.shared_emails) {
            try {
                const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (typeof entry === 'object' && entry !== null) {
                            if (String(entry.email).toLowerCase().trim() === userEmail) {
                                return entry.role === 'editor';
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
        console.error('[checkFolderUploadAccess] error:', err);
        return false;
    }
}

// Helper to check if a user is allowed to delete/modify a file (file owner OR folder owner OR folder editor)
async function canUserModifyFile(userId, fileId) {
    try {
        const { data: file, error } = await supabaseAdmin.from('files')
            .select('user_id, folder_id, file_path')
            .eq('id', fileId)
            .maybeSingle();

        if (error || !file) return false;

        // 1. File owner can modify
        if (String(file.user_id).trim() === String(userId).trim()) return true;

        // 2. Folder owner or editor can modify
        if (file.folder_id) {
            const { data: folder } = await supabaseAdmin.from('folders')
                .select('user_id, shared_emails')
                .eq('id', file.folder_id)
                .maybeSingle();

            if (folder) {
                if (String(folder.user_id).trim() === String(userId).trim()) return true; // Folder owner

                // Check editor role on folder
                const isEditor = await checkFolderUploadAccess(userId, file.folder_id);
                if (isEditor) return true;
            }
        }

        return false;
    } catch(err) {
        console.error('[canUserModifyFile] error:', err);
        return false;
    }
}

// DELETE /api/files/delete/[id]
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;

    try {
        const hasAccess = await canUserModifyFile(userId, id);
        if (!hasAccess) {
            return res.status(403).json({ error: 'You do not have permission to delete this file' });
        }

        const { error } = await supabaseAdmin
            .from('files')
            .update({ is_deleted: 1, deleted_at: new Date().toISOString() })
            .eq('id', id);

        if (error) return res.status(500).json({ error: 'Move to trash failed' });

        res.json({ success: true });
    } catch (err) {
        console.error('/files/delete error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
