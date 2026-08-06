const bcrypt   = require('bcryptjs');
const supabase  = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

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
        const { currentPassword, newPassword } = req.body || {};

        if (!currentPassword || !newPassword)
            return res.status(400).json({ error: 'All fields required' });
        if (newPassword.length < 6)
            return res.status(400).json({ error: 'New password too short (min 6 chars)' });

        // Get current hashed password
        const { data: user, error } = await supabase
            .from('users').select('password').eq('id', userId).single();

        if (error || !user) return res.status(404).json({ error: 'User not found' });

        // Verify current password
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(401).json({ error: 'Current password incorrect' });

        // Hash and update
        const hash = await bcrypt.hash(newPassword, 10);
        const { error: updateError } = await supabase
            .from('users').update({ password: hash }).eq('id', userId);

        if (updateError) return res.status(500).json({ error: 'Password update failed' });

        res.json({ success: true });
    } catch (err) {
        console.error('/change-password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
