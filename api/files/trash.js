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
            .from('files')
            .select('id, original_name, file_size, mime_type, deleted_at')
            .eq('user_id', userId)
            .eq('is_deleted', 1)
            .order('deleted_at', { ascending: false });

        if (error) return res.status(500).json({ error: 'Failed to load trash' });

        res.json((data || []).map(f => ({
            id:         f.id,
            name:       f.original_name,
            size:       Number(f.file_size) || 0,
            type:       f.mime_type,
            deleted_at: f.deleted_at
        })));
    } catch (err) {
        console.error('/files/trash error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
