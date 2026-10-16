const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

const JWT_SECRET = process.env.JWT_SECRET || 'ProcketDrive2024!SecretKey#xyz789';

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
        const { id, password, expiry } = req.body || {};
        if (!id) return res.status(400).json({ error: 'File ID is required' });

        const { data: file, error } = await supabaseAdmin
            .from('files')
            .select('id, original_name')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();

        if (error || !file) return res.status(404).json({ error: 'File not found' });

        let passwordHash = null;
        if (password && String(password).trim()) {
            passwordHash = crypto.createHash('sha256').update(String(password).trim()).digest('hex');
        }

        const payload = {
            fid: file.id,
            ph: passwordHash
        };

        const jwtOptions = {};
        if (expiry && expiry !== 'never') {
            jwtOptions.expiresIn = expiry; // '1h', '24h', '7d', '30d'
        }

        const token = jwt.sign(payload, JWT_SECRET, jwtOptions);
        res.json({
            token,
            hasPassword: !!passwordHash,
            expiry: expiry || 'never'
        });
    } catch (err) {
        console.error('[share-token API] error:', err);
        res.status(500).json({ error: 'Failed to generate protected token' });
    }
};
