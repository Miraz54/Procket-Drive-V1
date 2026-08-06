const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

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

    try {
        const userId = requireAuth(req, res);
        if (!userId) return;

        let userEmail = (req.session && req.session.userEmail) ? req.session.userEmail.toLowerCase().trim() : '';

        if (!userEmail && typeof userId === 'string' && userId.includes('@')) {
            userEmail = userId.toLowerCase().trim();
        }

        if (!userEmail) {
            try {
                // Try querying by string ID
                let { data: user } = await supabaseAdmin.from('users')
                    .select('email')
                    .eq('id', userId)
                    .maybeSingle();

                // Try querying by number if string ID failed and it is numeric
                if (!user && !isNaN(userId)) {
                    const numId = Number(userId);
                    const { data: userNum } = await supabaseAdmin.from('users')
                        .select('email')
                        .eq('id', numId)
                        .maybeSingle();
                    user = userNum;
                }

                if (user && user.email) {
                    userEmail = user.email.toLowerCase().trim();
                }
            } catch(e) {
                console.error('[shared-with-me] failed to get email:', e);
            }
        }

        let matchedFolderIds = new Set();

        // 1. folder_shares table — folders shared WITH this user by someone else
        if (userEmail) {
            try {
                const { data: shares } = await supabaseAdmin.from('folder_shares')
                    .select('folder_id, shared_by')
                    .ilike('shared_with_email', userEmail);

                if (shares && shares.length > 0) {
                    shares.forEach(s => {
                        // Only include if someone ELSE shared it
                        if (s.folder_id && String(s.shared_by) !== String(userId)) {
                            matchedFolderIds.add(String(s.folder_id));
                        }
                    });
                }
            } catch(e) {
                console.error('[shared-with-me] shares fetch error:', e);
            }
        }

        // 2. folders.shared_emails array — folders where user's email is in the list and they are NOT the owner
        try {
            const { data: allFolders } = await supabaseAdmin.from('folders').select('id, user_id, shared_emails');

            if (allFolders && allFolders.length > 0 && userEmail) {
                allFolders.forEach(f => {
                    if (!f.id) return;
                    const isOwner = String(f.user_id) === String(userId);
                    if (isOwner) return; // Skip own folders

                    if (f.shared_emails) {
                        let emails = [];
                        if (typeof f.shared_emails === 'string') {
                            try {
                                const parsed = JSON.parse(f.shared_emails);
                                emails = Array.isArray(parsed) ? parsed : [f.shared_emails];
                            } catch(e) {
                                emails = f.shared_emails.split(',').map(s => s.trim());
                            }
                        } else if (Array.isArray(f.shared_emails)) {
                            emails = f.shared_emails;
                        }

                        if (emails.some(entry => {
                            if (typeof entry === 'object' && entry !== null) {
                                return String(entry.email).toLowerCase().trim() === userEmail;
                            } else if (typeof entry === 'string') {
                                return entry.toLowerCase().trim() === userEmail;
                            }
                            return false;
                        })) {
                            matchedFolderIds.add(String(f.id));
                        }
                    }
                });
            }
        } catch(e) {
            console.error('[shared-with-me] allFolders check error:', e);
        }

        const finalFolderIds = Array.from(matchedFolderIds);
        if (finalFolderIds.length === 0) return res.json([]);

        // Fetch details of all matched folders directly by IDs to bypass strict RLS lists
        let folders = [];
        try {
            if (finalFolderIds.length > 0) {
                const { data: matchedFolders, error: fetchErr } = await supabaseAdmin.from('folders')
                    .select('*')
                    .in('id', finalFolderIds);
                
                if (fetchErr) {
                    console.error('[shared-with-me] fetch folders details error:', fetchErr);
                }
                if (matchedFolders) {
                    folders = matchedFolders;
                }
            }
        } catch(e) {
            console.error('[shared-with-me] folders detail check catch:', e);
        }

        if (!folders || folders.length === 0) return res.json([]);

        // Attach owner emails and file count
        const result = await Promise.all(folders.map(async f => {
            const isOwner = String(f.user_id) === String(userId);
            let ownerName = 'Folder Collaborator';
            let ownerEmail = 'Shared Folder';

            try {
                const { data: owner } = await supabaseAdmin.from('users')
                    .select('name, email')
                    .eq('id', f.user_id)
                    .maybeSingle();

                if (owner) {
                    ownerName = owner.name || owner.email;
                    ownerEmail = owner.email;
                }
            } catch(e) {}

            let fileCount = 0;
            try {
                const { data: files, error: filesErr } = await supabaseAdmin.from('files')
                    .select('id', { count: 'exact' })
                    .eq('folder_id', f.id)
                    .eq('is_deleted', 0);

                if (filesErr) {
                    console.error(`[shared-with-me] file count query error for folder ${f.id}:`, filesErr);
                }
                fileCount = files ? files.length : 0;
            } catch(e) {
                console.error('[shared-with-me] file count query catch:', e);
            }

            return {
                id: f.id,
                name: f.name,
                created_at: f.created_at,
                share_token: f.share_token,
                owner_name: isOwner ? 'You (Owner)' : ownerName,
                owner_email: isOwner ? (userEmail || 'Owner') : ownerEmail,
                file_count: fileCount,
                shareUrl: `/shared-folder/${f.share_token}`
            };
        }));

        res.json(result);
    } catch (err) {
        console.error('[api/folders/shared-with-me] safe catch:', err);
        res.json([]);
    }
};
