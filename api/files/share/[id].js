const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// GET /api/files/share/[id]
// Returns the public URL of a file (owner must be logged in)
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.query;

    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('file_path, original_name, mime_type, file_size')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error || !file) return res.status(404).json({ error: 'File not found' });

        res.json({
            url:  file.file_path,
            name: file.original_name,
            type: file.mime_type,
            size: Number(file.file_size) || 0
        });
    } catch (err) {
        console.error('/files/share error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
