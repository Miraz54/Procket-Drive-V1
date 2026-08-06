function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Use the same global OTP store as send-code
if (!global._otpStore) global._otpStore = new Map();
const otpStore = global._otpStore;

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

        const stored = otpStore.get(email);

        if (!stored)
            return res.status(400).json({ error: 'No verification code found. Please request a new one.' });

        if (Date.now() > stored.expiresAt) {
            otpStore.delete(email);
            return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
        }

        if (stored.code !== code)
            return res.status(400).json({ error: 'Invalid verification code' });

        // Mark as verified
        stored.verified = true;
        otpStore.set(email, stored);

        res.json({ success: true, message: 'Code verified successfully' });
    } catch (err) {
        console.error('verify-code error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
