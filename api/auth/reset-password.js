const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Use the same global OTP store
if (!global._otpStore) global._otpStore = new Map();
const otpStore = global._otpStore;

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

        // Check if code was verified
        const stored = otpStore.get(email);
        if (!stored || !stored.verified)
            return res.status(403).json({ error: 'Email not verified. Please complete verification first.' });

        // Hash and update
        const hash = await bcrypt.hash(newPassword, 10);
        const { error: dbError } = await supabase
            .from('users').update({ password: hash }).eq('email', email);

        if (dbError) return res.status(500).json({ error: 'Database update failed' });

        // Remove OTP
        otpStore.delete(email);

        res.json({ success: true, message: 'Password reset successful!' });
    } catch (err) {
        console.error('reset-password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
