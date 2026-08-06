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
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = requireAuth(req, res);
    if (!userId) return;

    const folderId = req.query.id;
    if (!folderId) return res.status(400).json({ error: 'Folder ID required' });

    if (req.method === 'POST') {
        try {
            let { email, role } = req.body || {};
            if (!email || !email.trim()) return res.status(400).json({ error: 'Email address required' });
            email = email.trim().toLowerCase();
            role = role === 'editor' ? 'editor' : 'viewer'; // default to viewer

            // Get folder
            const { data: folder, error: fetchErr } = await supabaseAdmin.from('folders')
                .select('*')
                .eq('id', folderId)
                .maybeSingle();

            if (fetchErr || !folder) return res.status(404).json({ error: 'Folder not found' });

            // Generate share_token if missing and mark is_shared: true
            let shareToken = folder.share_token;
            if (!shareToken) {
                const crypto = require('crypto');
                shareToken = crypto.randomBytes(24).toString('hex');
            }

            // Update folder (owner has full permissions)
            let updatedEmails = [];
            if (folder.shared_emails) {
                try {
                    const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                    updatedEmails = Array.isArray(parsed) ? parsed : [];
                } catch(e) { updatedEmails = []; }
            }

            // Filter out existing entries for this email (strings or objects)
            updatedEmails = updatedEmails.filter(entry => {
                if (typeof entry === 'object' && entry !== null) {
                    return String(entry.email).toLowerCase().trim() !== email;
                } else if (typeof entry === 'string') {
                    return entry.toLowerCase().trim() !== email;
                }
                return true;
            });

            // Push new entry with role
            updatedEmails.push({ email, role });

            try {
                await supabaseAdmin.from('folders')
                    .update({
                        is_shared: true,
                        share_token: shareToken,
                        shared_emails: JSON.stringify(updatedEmails)
                    })
                    .eq('id', folder.id);
            } catch(e) {
                console.warn('[share-email] folders update warning:', e.message);
            }

            // Insert into folder_shares (delete first to avoid duplicates)
            try {
                await supabaseAdmin.from('folder_shares')
                    .delete()
                    .eq('folder_id', folder.id)
                    .eq('shared_with_email', email);

                await supabaseAdmin.from('folder_shares').insert([{
                    folder_id: folder.id,
                    shared_with_email: email,
                    shared_by: userId,
                    role: role
                }]);
            } catch (dbErr) {
                console.warn('[share-email] folder_shares insert warning:', dbErr.message);
            }

            res.json({
                success: true,
                message: `Folder shared with ${email} as ${role}`,
                sharedWith: email,
                shareToken,
                role
            });
        } catch (err) {
            console.error('[api/folders/share-email] error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    } else if (req.method === 'DELETE') {
        try {
            let { email } = req.body || {};
            if (!email) return res.status(400).json({ error: 'Email required' });
            email = email.trim().toLowerCase();

            try {
                await supabaseAdmin.from('folder_shares')
                    .delete()
                    .eq('folder_id', folderId)
                    .eq('shared_with_email', email);
            } catch(e) {}

            const { data: folder } = await supabaseAdmin.from('folders')
                .select('id, shared_emails')
                .eq('id', folderId)
                .maybeSingle();

            if (folder && folder.shared_emails) {
                try {
                    let entries = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                    if (Array.isArray(entries)) {
                        entries = entries.filter(entry => {
                            if (typeof entry === 'object' && entry !== null) {
                                return entry.email.toLowerCase() !== email;
                            } else if (typeof entry === 'string') {
                                return entry.toLowerCase() !== email;
                            }
                            return true;
                        });
                        await supabaseAdmin.from('folders')
                            .update({ shared_emails: JSON.stringify(entries) })
                            .eq('id', folder.id);
                    }
                } catch(e) {}
            }

            res.json({ success: true, message: `Revoked access for ${email}` });
        } catch(err) {
            res.status(500).json({ error: 'Server error' });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
};
