const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');
const { validateFileSafety } = require('../../lib/security');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

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
        const { filename, mimeType, folder_id } = req.body || {};
        if (!filename) return res.status(400).json({ error: 'Filename is required' });

        const safetyCheck = validateFileSafety(filename);
        if (!safetyCheck.allowed) {
            return res.status(400).json({ error: safetyCheck.reason });
        }

        const validFolderId = (folder_id && folder_id !== 'null' && folder_id !== 'undefined') ? folder_id : null;
        let storageOwnerId = userId;

        if (validFolderId) {
            try {
                const { data: folderRow } = await supabaseAdmin.from('folders')
                    .select('user_id')
                    .eq('id', validFolderId)
                    .maybeSingle();
                if (folderRow && folderRow.user_id) {
                    storageOwnerId = folderRow.user_id;
                }
            } catch(e) {}
        }

        const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const filePath = `${storageOwnerId}/${safeName}`;

        const { data: signedData, error: signErr } = await supabaseAdmin.storage
            .from('userfiles')
            .createSignedUploadUrl(filePath);

        if (signErr || !signedData) {
            console.error('[signed-upload] Error:', signErr);
            return res.status(500).json({ error: 'Failed to create upload URL' });
        }

        const { data: urlData } = supabaseAdmin.storage.from('userfiles').getPublicUrl(filePath);

        res.json({
            success: true,
            signedUrl: signedData.signedUrl,
            token: signedData.token,
            filePath,
            publicUrl: urlData.publicUrl,
            safeName
        });
    } catch(err) {
        console.error('[signed-upload] Catch error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
