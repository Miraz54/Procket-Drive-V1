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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Share token required' });

    try {
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

                // Try numeric conversion fallback
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
                console.error('[api/folders/accept] failed to get email:', e);
            }
        }

        if (!userEmail) return res.status(400).json({ error: 'User email not found' });

        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('*')
            .eq('share_token', token)
            .maybeSingle();

        if (error || !folder) return res.status(404).json({ error: 'Shared folder not found or link expired' });

        // 1. Insert into folder_shares (Delete existing to avoid duplicates, default role as viewer)
        try {
            await supabaseAdmin.from('folder_shares')
                .delete()
                .eq('folder_id', folder.id)
                .eq('shared_with_email', userEmail);

            const { error: insertErr } = await supabaseAdmin.from('folder_shares').insert([{
                folder_id: folder.id,
                shared_with_email: userEmail,
                shared_by: folder.user_id,
                role: 'viewer'
            }]);
            if (insertErr) {
                console.error('[api/folders/accept] folder_shares insert error:', insertErr);
            }
        } catch(e) {
            console.error('[api/folders/accept] folder_shares catch:', e);
        }

        // 2. Add to shared_emails array on folders
        try {
            let emails = [];
            if (folder.shared_emails) {
                try {
                    const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                    emails = Array.isArray(parsed) ? parsed : [];
                } catch(e) { emails = []; }
            }

            // If it's a string email, we normalize it to viewer role or keep editor
            if (!emails.some(entry => {
                if (typeof entry === 'object' && entry !== null) {
                    return String(entry.email).toLowerCase().trim() === userEmail;
                } else if (typeof entry === 'string') {
                    return entry.toLowerCase().trim() === userEmail;
                }
                return false;
            })) {
                emails.push({ email: userEmail, role: 'viewer' });
            }

            const { error: updateErr } = await supabaseAdmin.from('folders')
                .update({ is_shared: true, shared_emails: JSON.stringify(emails) })
                .eq('id', folder.id);
            if (updateErr) {
                console.error('[api/folders/accept] folders update error:', updateErr);
            }
        } catch(e) {
            console.error('[api/folders/accept] folders update catch:', e);
        }

        res.json({
            success: true,
            message: `You accepted invitation for folder "${folder.name}"`,
            folder: { id: folder.id, name: folder.name, share_token: folder.share_token }
        });
    } catch (err) {
        console.error('[api/folders/accept] error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
};
