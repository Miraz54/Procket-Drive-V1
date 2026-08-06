const bcrypt  = require('bcryptjs');
const supabase = require('../../lib/supabase');
const { signToken, setTokenCookie } = require('../../lib/auth');

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
        let { email, password } = req.body;
        email = email?.trim().toLowerCase();

        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });

        // Find user
        const { data: user, error } = await supabase
            .from('users').select('*').eq('email', email).maybeSingle();

        if (error || !user)
            return res.status(401).json({ error: 'No account found with this email' });

        // Check password
        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.status(401).json({ error: 'Incorrect password. Please try again.' });

        // Issue JWT cookie
        const token = signToken(user.id);
        setTokenCookie(res, token);

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                profile_picture: user.profile_picture
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login error' });
    }
};
