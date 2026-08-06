const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        const { folder_id } = req.query;

        // Initialize admin client to bypass RLS
        const { createClient } = require('@supabase/supabase-js');
        const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
            : supabase;

        // Check folder access helper function
        async function checkFolderAccess(uId, fId) {
            if (!fId) return true;
            try {
                const { data: folder } = await supabaseAdmin.from('folders')
                    .select('user_id, shared_emails')
                    .eq('id', fId)
                    .maybeSingle();

                if (!folder) return false;
                if (String(folder.user_id).trim() === String(uId).trim()) return true;

                const { data: user } = await supabase.from('users')
                    .select('email')
                    .eq('id', uId)
                    .maybeSingle();

                if (!user || !user.email) return false;
                const userEmail = user.email.toLowerCase().trim();

                const { data: share } = await supabaseAdmin.from('folder_shares')
                    .select('id')
                    .eq('folder_id', fId)
                    .eq('shared_with_email', userEmail)
                    .maybeSingle();

                if (share) return true;

                if (folder.shared_emails) {
                    let emailsList = [];
                    try {
                        const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                        if (Array.isArray(parsed)) emailsList = parsed;
                    } catch(e) {}

                    for (const entry of emailsList) {
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
                return false;
            } catch (err) {
                console.error('[checkFolderAccess] error:', err);
                return false;
            }
        }

        let query = supabase.from('files').select('*')
            .eq('is_deleted', 0)
            .order('uploaded_at', { ascending: false });

        if (folder_id) {
            // Verify folder access
            const hasAccess = await checkFolderAccess(userId, folder_id);
            if (!hasAccess) {
                return res.status(403).json({ error: 'Access denied to folder' });
            }
            query = query.eq('folder_id', folder_id);
        } else {
            // Root directory lists user's own files only
            query = query.eq('user_id', userId).is('folder_id', null);
        }

        const { data, error } = await query;

        if (error) {
            console.error('files/list DB error:', error);
            return res.status(500).json({ error: 'Failed to list files' });
        }


        // Map to frontend-expected format
        const files = data.map(f => ({
            id:          f.id,
            name:        f.original_name,
            size:        Number(f.file_size) || 0,
            type:        f.mime_type,
            uploaded_at: f.uploaded_at,
            folder_id:   f.folder_id
        }));

        res.json(files);
    } catch (err) {
        console.error('/files/list error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
