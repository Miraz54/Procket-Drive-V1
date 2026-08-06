const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

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

    try {
        const { name, parent_id } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name required' });

        const trimmedName = name.trim();

        // Check duplicate folder name in same directory
        let checkQuery = supabase.from('folders').select('id').eq('user_id', userId).ilike('name', trimmedName);
        if (parent_id) {
            checkQuery = checkQuery.eq('parent_id', parent_id);
        } else {
            checkQuery = checkQuery.is('parent_id', null);
        }
        const { data: existing } = await checkQuery;
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: `Folder "${trimmedName}" already exists` });
        }

        const { data, error } = await supabase.from('folders').insert([{
            user_id: userId,
            name: trimmedName,
            parent_id: parent_id || null
        }]).select().single();

        if (error) return res.status(500).json({ error: 'Failed to create folder' });
        res.json({ success: true, folder: data });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};
