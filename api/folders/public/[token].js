const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../../lib/supabase');
const { verifyToken } = require('../../../lib/auth');

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

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { token } = req.query;

    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('id, name, created_at, shared_emails, user_id')
            .eq('share_token', token)
            .eq('is_shared', true)
            .single();

        if (error || !folder) return res.status(404).json({ error: 'Shared folder not found' });

        // Check if the current user has already accepted or is owner
        let alreadyAccepted = false;
        let userRole = 'viewer'; // Default to viewer
        
        // Extract userId from JWT cookie, fallback to memory session
        const userId = verifyToken(req) || (req.session && req.session.userId);
        let userEmail = req.session && req.session.userEmail;

        if (userId && !userEmail) {
            try {
                const { data: u } = await supabaseAdmin.from('users').select('email').eq('id', userId).maybeSingle();
                if (u) userEmail = u.email;
            } catch(e) {}
        }

        if (userId) {
            if (String(folder.user_id) === String(userId)) {
                alreadyAccepted = true;
                userRole = 'editor';
            } else {
                if (userEmail) {
                    const emailNormalized = userEmail.toLowerCase().trim();
                    
                    // 1. Check folder_shares table
                    try {
                        const { data: share } = await supabaseAdmin.from('folder_shares')
                            .select('role')
                            .eq('folder_id', folder.id)
                            .eq('shared_with_email', emailNormalized)
                            .maybeSingle();
                        if (share) {
                            alreadyAccepted = true;
                            userRole = share.role || 'viewer';
                        }
                    } catch(e) {}

                    // 2. Check folders.shared_emails
                    if (!alreadyAccepted && folder.shared_emails) {
                        let emails = [];
                        try {
                            const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                            emails = Array.isArray(parsed) ? parsed : [];
                        } catch(e) {}

                        for (const entry of emails) {
                            if (typeof entry === 'object' && entry !== null) {
                                if (String(entry.email).toLowerCase().trim() === emailNormalized) {
                                    alreadyAccepted = true;
                                    userRole = entry.role || 'viewer';
                                    break;
                                }
                            } else if (typeof entry === 'string') {
                                if (entry.toLowerCase().trim() === emailNormalized) {
                                    alreadyAccepted = true;
                                    userRole = 'editor';
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        const { data: files } = await supabaseAdmin.from('files')
            .select('id, original_name, file_size, mime_type, uploaded_at, file_path')
            .eq('folder_id', folder.id)
            .eq('is_deleted', 0)
            .order('uploaded_at', { ascending: false });

        res.json({
            folder: { id: folder.id, name: folder.name, created_at: folder.created_at },
            alreadyAccepted,
            userRole,
            files: (files || []).map(f => ({
                id: f.id,
                name: f.original_name,
                size: Number(f.file_size) || 0,
                type: f.mime_type,
                uploaded_at: f.uploaded_at,
                downloadUrl: `/api/files/public/download/${f.id}`
            }))
        });
    } catch (err) {
        console.error('[public-folder] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
