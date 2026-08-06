const supabase = require('../../../lib/supabase');
const { requireAuth } = require('../../../lib/auth');
const crypto = require('crypto');

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

    const { id } = req.query;
    try {
        const { data: folder, error: fetchErr } = await supabase.from('folders')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (fetchErr || !folder) return res.status(404).json({ error: 'Folder not found' });

        let token = folder.share_token;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            await supabase.from('folders')
                .update({ is_shared: true, share_token: token })
                .eq('id', id);
        }

        const host = req.headers.host || '';
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const shareUrl = `${protocol}://${host}/shared-folder/${token}`;

        res.json({
            success: true,
            token,
            shareUrl,
            folderName: folder.name
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
};
