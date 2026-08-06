const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// POST /api/files/restore/[id]
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;

    try {
        const { error } = await supabase
            .from('files')
            .update({ is_deleted: 0, deleted_at: null })
            .eq('id', id)
            .eq('user_id', userId);

        if (error) return res.status(500).json({ error: 'Restore failed' });

        res.json({ success: true });
    } catch (err) {
        console.error('/files/restore error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
