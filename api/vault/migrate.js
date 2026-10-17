const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');
const { migrateLegacyFiles } = require('../../lib/vault');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vault-Token');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        const { fileIds } = req.body || {};
        if (Array.isArray(fileIds) && fileIds.length > 0) {
            await migrateLegacyFiles(supabaseAdmin, userId, fileIds);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[api/vault/migrate] error:', err);
        res.status(500).json({ error: 'Migration failed' });
    }
};
