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
            .select('file_size, is_deleted')
            .eq('user_id', userId)
            .or('is_deleted.eq.0,is_deleted.is.null');

        if (error) return res.status(500).json({ error: 'Failed to fetch stats' });

        const filesList  = data || [];
        const usedBytes  = filesList.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0);
        const totalBytes = 15 * 1024 * 1024 * 1024; // 15 GB

        res.json({ used: usedBytes, total: totalBytes, count: filesList.length });
    } catch (err) {
        console.error('/files/storage-stats error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
