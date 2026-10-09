const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

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
        const { original_name, file_path, file_size, mime_type, folder_id } = req.body || {};
        if (!original_name || !file_path) {
            return res.status(400).json({ error: 'Missing file details' });
        }

        const validFolderId = (folder_id && folder_id !== 'null' && folder_id !== 'undefined') ? folder_id : null;

        const { data: inserted, error: dbError } = await supabaseAdmin
            .from('files')
            .insert([{
                user_id: userId,
                original_name,
                file_path,
                file_size: Number(file_size) || 0,
                mime_type: mime_type || 'application/octet-stream',
                folder_id: validFolderId,
                is_deleted: 0
            }])
            .select()
            .single();

        if (dbError) {
            console.error('[save-meta] DB error:', dbError);
            return res.status(500).json({ error: 'Database insert failed' });
        }

        res.json({
            success: true,
            file: {
                id: inserted.id,
                name: original_name,
                size: inserted.file_size,
                type: inserted.mime_type,
                uploaded_at: inserted.uploaded_at,
                folder_id: validFolderId
            }
        });
    } catch(err) {
        console.error('[save-meta] Catch error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
