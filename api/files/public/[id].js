const supabase = require('../../../lib/supabase');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// GET /api/files/public/[id]
// Public endpoint - returns metadata for shared file preview
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { id } = req.query;

    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('id, file_path, original_name, mime_type, file_size, uploaded_at')
            .eq('id', id)
            .eq('is_deleted', 0)
            .single();

        if (error || !file) return res.status(404).json({ error: 'File not found or deleted' });

        res.json({
            id: file.id,
            url: file.file_path,
            name: file.original_name,
            type: file.mime_type,
            size: Number(file.file_size) || 0,
            uploaded_at: file.uploaded_at
        });
    } catch (err) {
        console.error('/api/files/public error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
