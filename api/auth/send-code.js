const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// In-memory OTP store (shared across warm function instances)
// Note: In Vercel serverless, each function invocation may be a new instance.
// For production scale, use Redis/database. For this scale, we use a shared module.
if (!global._otpStore) global._otpStore = new Map();
const otpStore = global._otpStore;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

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
        let { email } = req.body || {};
        email = email?.trim().toLowerCase();

        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Check user exists
        const { data: user, error: fetchError } = await supabase
            .from('users').select('id').eq('email', email).maybeSingle();

        if (fetchError || !user)
            return res.status(400).json({ error: 'No account found with this email' });

        // Rate limit
        const existing = otpStore.get(email);
        if (existing && (Date.now() - (existing.createdAt || 0)) < 60000)
            return res.status(429).json({ error: 'Please wait before requesting another code' });

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        otpStore.set(email, {
            code,
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: Date.now(),
            verified: false
        });

        // Send email
        await transporter.sendMail({
            from: `"Pocket Drive" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: `${code} — Your Pocket Drive verification code`,
            html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0b0f1a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f1a;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:20px;border:1px solid rgba(108,99,255,0.3);overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c63ff,#a78bfa);padding:32px 40px;text-align:center;">
<div style="font-size:28px;font-weight:800;color:#fff;">🚀 Pocket Drive</div>
<div style="font-size:14px;color:rgba(255,255,255,0.8);margin-top:6px;">Password Reset Verification</div>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="color:#f1f5ff;font-size:16px;margin:0 0 8px;font-weight:600;">Hello! 👋</p>
<p style="color:#7f8eab;font-size:14px;line-height:1.6;margin:0 0 28px;">Use the code below to reset your password. Valid for <strong style="color:#a78bfa;">5 minutes</strong>.</p>
<div style="text-align:center;margin:0 0 28px;">
<div style="display:inline-block;background:rgba(108,99,255,0.12);border:2px solid rgba(108,99,255,0.4);border-radius:16px;padding:20px 40px;">
<div style="font-size:36px;font-weight:900;letter-spacing:12px;color:#a78bfa;font-family:'Courier New',monospace;">${code}</div>
</div></div>
<p style="color:#7f8eab;font-size:13px;margin:0;">If you didn't request this, ignore this email.</p>
</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
<p style="color:#3e4d6b;font-size:12px;margin:0;">© ${new Date().getFullYear()} Pocket Drive</p>
</td></tr></table>
</td></tr></table></body></html>`
        });

        res.json({ success: true, message: 'Verification code sent to your email' });
    } catch (err) {
        console.error('send-code error:', err);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
};
