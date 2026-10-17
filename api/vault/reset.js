const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');
const { requireAuth, signVaultToken, setVaultTokenCookie } = require('../../lib/auth');
const { resetVaultPinWithPassword } = require('../../lib/vault');

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
        const { accountPassword, newPin } = req.body || {};
        if (!accountPassword || !newPin) {
            return res.status(400).json({ error: 'Account password and new PIN are required' });
        }

        await resetVaultPinWithPassword(supabaseAdmin, userId, accountPassword, newPin);

        const vaultToken = signVaultToken(userId);
        setVaultTokenCookie(res, vaultToken);

        res.json({
            success: true,
            message: 'PIN successfully reset and vault unlocked'
        });
    } catch (err) {
        console.error('[api/vault/reset] error:', err);
        res.status(400).json({ error: err.message || 'Failed to reset PIN' });
    }
};
