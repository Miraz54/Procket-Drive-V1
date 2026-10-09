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
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        let ids = [];
        if (req.body) {
            try {
                const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                ids = Array.isArray(body.ids) ? body.ids : (Array.isArray(body) ? body : []);
            } catch(e) {
                ids = [];
            }
        }
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'IDs array required' });
        }

        const cleanIds = ids.map(id => String(id).trim()).filter(Boolean);
        if (cleanIds.length === 0) {
            return res.status(400).json({ error: 'Valid IDs required' });
        }

        // Fetch files belonging to this user
        const { data: files, error: fetchErr } = await supabaseAdmin
            .from('files')
            .select('id, user_id, file_path')
            .in('id', cleanIds)
            .eq('user_id', userId);

        if (fetchErr) {
            console.error('[permanent-batch] Fetch error:', fetchErr);
            return res.status(500).json({ error: 'Fetch failed' });
        }

        if (!files || files.length === 0) {
            return res.json({ success: true, deleted: 0, deletedIds: [] });
        }

        const validIds = files.map(f => f.id);

        // Delete from DB immediately
        const { error: delErr } = await supabaseAdmin
            .from('files')
            .delete()
            .in('id', validIds)
            .eq('user_id', userId);

        if (delErr) {
            console.error('[permanent-batch] DB delete error:', delErr);
            return res.status(500).json({ error: 'Failed to delete records' });
        }

        // Cleanup storage asynchronously (non-blocking)
        const storagePaths = files.map(f => {
            const parts = f.file_path ? f.file_path.split('/userfiles/') : [];
            return parts.length > 1 ? parts[1] : null;
        }).filter(Boolean);

        if (storagePaths.length > 0) {
            supabaseAdmin.storage.from('userfiles').remove(storagePaths).catch(err => {
                console.warn('[permanent-batch] Storage cleanup error:', err.message);
            });
        }

        res.json({ success: true, deleted: validIds.length, deletedIds: validIds.map(String) });
    } catch(err) {
        console.error('[permanent-batch] Catch error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
