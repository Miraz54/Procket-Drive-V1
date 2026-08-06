const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;
    try {
        // Move files in this folder to root (folder_id = null)
        await supabase.from('files')
            .update({ folder_id: null })
            .eq('folder_id', id);

        const { error } = await supabase.from('folders')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) return res.status(500).json({ error: 'Delete failed' });
        res.json({ success: true });
    } catch (err) {
        console.error('[folders/delete] catch:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
