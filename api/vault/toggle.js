const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');
const { isVaultSetup, toggleVaultFile } = require('../../lib/vault');

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
        const { fileId } = req.body || {};
        if (!fileId) return res.status(400).json({ error: 'fileId is required' });

        const setup = await isVaultSetup(supabaseAdmin, userId);
        if (!setup) return res.status(400).json({ error: 'Please setup your Vault PIN first' });

        const result = await toggleVaultFile(supabaseAdmin, userId, fileId);
        res.json({
            success: true,
            inVault: result.inVault,
            file: result.file
        });
    } catch (err) {
        console.error('[api/vault/toggle] error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
};
