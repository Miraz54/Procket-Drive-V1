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

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const folderId = req.query.id;
    if (!folderId) return res.status(400).json({ error: 'Folder ID required' });

    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('id, shared_emails')
            .eq('id', folderId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error || !folder) return res.status(404).json({ error: 'Folder not found' });

        let emailsList = [];
        // Try folder_shares table first
        try {
            const { data: shares } = await supabaseAdmin.from('folder_shares')
                .select('shared_with_email, role')
                .eq('folder_id', folder.id);

            if (shares && shares.length > 0) {
                emailsList = shares.map(s => ({
                    email: s.shared_with_email,
                    role: s.role || 'viewer'
                }));
            }
        } catch(e) {}

        // Fallback or merge from folders.shared_emails
        if (emailsList.length === 0 && folder.shared_emails) {
            try {
                const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(parsed)) {
                    emailsList = parsed.map(entry => {
                        if (typeof entry === 'object' && entry !== null) {
                            return { email: entry.email, role: entry.role || 'viewer' };
                        } else if (typeof entry === 'string') {
                            return { email: entry, role: 'viewer' };
                        }
                    });
                }
            } catch(e) {}
        }

        // De-duplicate list by email
        const unique = [];
        const seen = new Set();
        for (const entry of emailsList) {
            if (entry && entry.email && !seen.has(entry.email.toLowerCase())) {
                seen.add(entry.email.toLowerCase());
                unique.push(entry);
            }
        }

        res.json({ emails: unique });
    } catch (err) {
        console.error('[api/folders/shared-emails] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
