const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

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

    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, email, name, profile_picture')
            .eq('id', userId)
            .single();

        if (error || !data) return res.status(404).json({ error: 'User not found' });

        res.json(data);
    } catch (err) {
        console.error('/me error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
