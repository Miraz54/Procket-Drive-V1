const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// PUT /api/auth/profile/name
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { name } = req.body || {};
    if (!name || name.trim() === '')
        return res.status(400).json({ error: 'Name required' });

    try {
        const { error } = await supabase
            .from('users')
            .update({ name: name.trim() })
            .eq('id', userId);

        if (error) return res.status(500).json({ error: 'Update failed' });

        res.json({ success: true });
    } catch (err) {
        console.error('/profile/name error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
