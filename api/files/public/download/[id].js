const supabase = require('../../../../lib/supabase');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// GET /api/files/public/download/[id]
// Public endpoint - forces file download without requiring login
module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { id } = req.query;

    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('file_path, original_name, mime_type')
            .eq('id', id)
            .single();

        if (error || !file) return res.status(404).json({ error: 'File not found' });

        // Extract relative storage path
        const parts = file.file_path.split('/userfiles/');
        if (parts.length < 2) return res.status(500).json({ error: 'Invalid file path' });
        const storagePath = parts[1];

        const { data, error: downloadError } = await supabase.storage
            .from('userfiles')
            .download(storagePath);

        if (downloadError) return res.status(500).json({ error: 'Download failed' });

        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        console.error('/api/files/public/download error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
