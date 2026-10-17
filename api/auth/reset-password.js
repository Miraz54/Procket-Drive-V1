const bcrypt = require('bcryptjs');
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
        let { email, newPassword } = req.body || {};
        email = email?.trim().toLowerCase();

        if (!email || !newPassword)
            return res.status(400).json({ error: 'Missing required fields' });
        if (newPassword.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });

        // Verify that reset_token is valid and not expired
        const { data: user, error: fetchError } = await supabaseAdmin
            .from('users')
            .select('id, reset_token, reset_expires')
            .eq('email', email)
            .maybeSingle();

        if (fetchError || !user || !user.reset_token)
            return res.status(403).json({ error: 'No active verification session. Please request a new code.' });

        if (new Date(user.reset_expires) < new Date())
            return res.status(403).json({ error: 'Verification code has expired. Please request a new one.' });

        // Hash and update password, clear reset_token
        const hash = await bcrypt.hash(newPassword, 10);
        const { error: dbError } = await supabaseAdmin
            .from('users')
            .update({ password: hash, reset_token: null, reset_expires: null })
            .eq('email', email);

        if (dbError) return res.status(500).json({ error: 'Database update failed' });

        res.json({ success: true, message: 'Password reset successful!' });
    } catch (err) {
        console.error('reset-password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
