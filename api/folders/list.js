const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        const { parent_id } = req.query;
        let query = supabase.from('folders')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (parent_id) {
            query = query.eq('parent_id', parent_id);
        } else {
            query = query.is('parent_id', null);
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: 'Failed to list folders' });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};
