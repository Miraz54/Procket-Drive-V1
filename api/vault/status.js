const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth, verifyVaultToken } = require('../../lib/auth');
const { isVaultSetup } = require('../../lib/vault');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vault-Token');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

module.exports = async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        const setup = await isVaultSetup(supabaseAdmin, userId);
        let unlocked = false;
        if (setup) {
            const vaultUid = verifyVaultToken(req);
            unlocked = !!(vaultUid && String(vaultUid) === String(userId));
        }

        res.json({
            isSetup: setup,
            isUnlocked: unlocked
        });
    } catch (err) {
        console.error('[api/vault/status] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
