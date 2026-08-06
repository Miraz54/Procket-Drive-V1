const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;
    try {
        const { name } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

        const { error } = await supabase.from('folders')
            .update({ name: name.trim() })
            .eq('id', id)
            .eq('user_id', userId);

        if (error) return res.status(500).json({ error: 'Rename failed' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};
