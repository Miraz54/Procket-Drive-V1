const bcrypt   = require('bcryptjs');
const validator = require('validator');
const supabase  = require('../../lib/supabase');
const { signToken, setTokenCookie } = require('../../lib/auth');

// ─── CORS helper ─────────────────────────────────────────────
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

        if (!email || !password)          return res.status(400).json({ error: 'Missing fields' });
        if (!validator.isEmail(email))    return res.status(400).json({ error: 'Invalid email format' });

        // Only Gmail allowed
        const gmailRegex = /^[a-zA-Z0-9](\.?[a-zA-Z0-9]){5,29}@gmail\.com$/;
        if (!gmailRegex.test(email))      return res.status(400).json({ error: 'Only Gmail accounts are allowed' });
        if (password.length < 6)          return res.status(400).json({ error: 'Password must be at least 6 characters' });

        // Check if user already exists
        const { data: existing } = await supabase
            .from('users').select('id').eq('email', email).maybeSingle();
        if (existing) return res.status(400).json({ error: 'Email already registered' });

        // Hash & insert
        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabase
            .from('users')
            .insert([{ email, password: hash, name: 'User' }])
            .select()
            .single();

        if (error) {
            console.error('Register DB error:', error);
            return res.status(500).json({ error: 'Registration failed' });
        }

        res.status(201).json({ success: true, user: { id: data.id, email: data.email } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
