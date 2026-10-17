const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../lib/supabase');

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

    try {
        let { email, code } = req.body || {};
        email = email?.trim().toLowerCase();
        code = code?.trim();

        if (!email || !code)
            return res.status(400).json({ error: 'Email and code are required' });

        const { data: user, error: fetchError } = await supabaseAdmin
            .from('users')
            .select('reset_token, reset_expires')
            .eq('email', email)
            .maybeSingle();

        if (fetchError || !user || !user.reset_token)
            return res.status(400).json({ error: 'No verification code found. Please request a new one.' });

        if (new Date(user.reset_expires) < new Date())
            return res.status(400).json({ error: 'Code has expired. Please request a new one.' });

        if (String(user.reset_token).trim() !== code)
            return res.status(400).json({ error: 'Invalid verification code' });

        res.json({ success: true, message: 'Code verified successfully' });
    } catch (err) {
        console.error('verify-code error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
