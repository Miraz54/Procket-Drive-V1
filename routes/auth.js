const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const validator = require('validator');
const { createClient } = require('@supabase/supabase-js');
const { signToken, setTokenCookie, clearTokenCookie, verifyToken } = require('../lib/auth');

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// =========================
// AUTH MIDDLEWARE
// =========================
function requireAuth(req, res, next) {
    const userId = (req.session && req.session.userId) || verifyToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.session) req.session = {};
    req.session.userId = userId;
    next();
}

// =========================
// REGISTER
// =========================
router.post('/register', async (req, res) => {
    try {
        let { email, password } = req.body;

        // Trim + lowercase
        email = email?.trim().toLowerCase();

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                error: 'Missing fields'
            });
        }

        // Valid email check
        if (!validator.isEmail(email)) {
            return res.status(400).json({
                error: 'Invalid email format'
            });
        }

        // ONLY GMAIL ALLOWED
        const gmailRegex = /^[a-zA-Z0-9](\.?[a-zA-Z0-9]){5,29}@gmail\.com$/;

        if (!gmailRegex.test(email)) {
            return res.status(400).json({
                error: 'Only Gmail accounts are allowed'
            });
        }

        // Password validation
        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must be at least 6 characters'
            });
        }

        // Check existing user
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({
                error: 'Email already exists'
            });
        }

        // Hash password
        const hash = await bcrypt.hash(password, 10);

        // Insert user
        const { data, error } = await supabase
            .from('users')
            .insert([
                {
                    email,
                    password: hash,
                    name: 'User'
                }
            ])
            .select()
            .single();

        if (error) {
            console.error(error);

            return res.status(500).json({
                error: 'Registration failed'
            });
        }

        res.json({
            success: true,
            user: {
                id: data.id,
                email: data.email
            }
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// =========================
// LOGIN
// =========================
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;

        email = email?.trim().toLowerCase();

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password required'
            });
        }

        // Find user
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({
                error: 'No account found with this email'
            });
        }

        // Compare password
        const match = await bcrypt.compare(
            password,
            user.password
        );

        if (!match) {
            return res.status(401).json({
                error: 'Incorrect password. Please try again.'
            });
        }

        // Session save
        req.session.userId = user.id;
        req.session.userEmail = user.email;

        // Set JWT pd_token cookie for Vercel Serverless Functions
        try {
            const token = signToken(user.id);
            setTokenCookie(res, token);
        } catch(e) { console.error('Set JWT cookie error:', e); }

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
        console.error(err);

        res.status(500).json({
            error: 'Login error'
        });
    }
});

// =========================
// CURRENT USER
// =========================
router.get('/me', requireAuth, async (req, res) => {
    try {

        const { data, error } = await supabase
            .from('users')
            .select('id, email, name, profile_picture')
            .eq('id', req.session.userId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json(data);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// =========================
// LOGOUT
// =========================
router.post('/logout', (req, res) => {
    clearTokenCookie(res);
    req.session.destroy((err) => {

        if (err) {
            return res.status(500).json({
                error: 'Logout failed'
            });
        }

        res.clearCookie('connect.sid');

        res.json({
            success: true
        });
    });
});

// =========================
// CHANGE PASSWORD
// =========================
router.post('/change-password', requireAuth, async (req, res) => {
    try {

        const {
            currentPassword,
            newPassword
        } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'All fields required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'New password too short'
            });
        }

        // Get user
        const { data: user, error } = await supabase
            .from('users')
            .select('password')
            .eq('id', req.session.userId)
            .single();

        if (error || !user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Check current password
        const match = await bcrypt.compare(
            currentPassword,
            user.password
        );

        if (!match) {
            return res.status(401).json({
                error: 'Current password incorrect'
            });
        }

        // Hash new password
        const hash = await bcrypt.hash(newPassword, 10);

        // Update
        const { error: updateError } = await supabase
            .from('users')
            .update({
                password: hash
            })
            .eq('id', req.session.userId);

        if (updateError) {
            return res.status(500).json({
                error: 'Password update failed'
            });
        }

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// =========================
// PROFILE
// =========================
router.get('/profile', requireAuth, async (req, res) => {

    const { data, error } = await supabase
        .from('users')
        .select('id, email, name, profile_picture')
        .eq('id', req.session.userId)
        .single();

    if (error) {
        return res.status(500).json({
            error: 'DB error'
        });
    }

    res.json(data);
});

// =========================
// UPDATE NAME
// =========================
router.put('/profile/name', requireAuth, async (req, res) => {

    const { name } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({
            error: 'Name required'
        });
    }

    await supabase
        .from('users')
        .update({
            name: name.trim()
        })
        .eq('id', req.session.userId);

    res.json({
        success: true
    });
});

// =========================
// PROFILE PICTURE UPLOAD
// =========================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

router.post(
    '/profile/picture',
    requireAuth,
    upload.single('profile_pic'),
    async (req, res) => {

        try {

            if (!req.file) {
                return res.status(400).json({
                    error: 'No file uploaded'
                });
            }

            // Only image allow
            if (!req.file.mimetype.startsWith('image/')) {
                return res.status(400).json({
                    error: 'Only images allowed'
                });
            }

            const ext = req.file.originalname
                .split('.')
                .pop();

            const fileName =
                `profile_${req.session.userId}_${Date.now()}.${ext}`;

            // Upload
            const { error: uploadError } =
                await supabase.storage
                    .from('avatars')
                    .upload(
                        fileName,
                        req.file.buffer,
                        {
                            contentType: req.file.mimetype
                        }
                    );

            if (uploadError) {
                return res.status(500).json({
                    error:
                        'Upload failed: ' +
                        uploadError.message
                });
            }

            // Public URL
            const { data: urlData } =
                supabase.storage
                    .from('avatars')
                    .getPublicUrl(fileName);

            // Update DB
            await supabase
                .from('users')
                .update({
                    profile_picture:
                        urlData.publicUrl
                })
                .eq(
                    'id',
                    req.session.userId
                );

            res.json({
                success: true,
                profile_picture:
                    urlData.publicUrl
            });

        } catch (err) {
            console.error(err);

            res.status(500).json({
                error: 'Upload failed'
            });
        }
    }
);

// =========================
// FORGOT PASSWORD — OTP EMAIL VERIFICATION
// =========================
const { sendVerificationCode } = require('../lib/mailer');

// In-memory OTP store: Map<email, { code, expiresAt, verified }>
const otpStore = new Map();

// Cleanup expired OTPs every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore) {
        if (now > data.expiresAt) otpStore.delete(email);
    }
}, 10 * 60 * 1000);

// Step 1: Send verification code to email
router.post('/forgot-password/send-code', async (req, res) => {
    try {
        let { email } = req.body;
        email = email?.trim().toLowerCase();

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Check user exists
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (fetchError || !user) {
            return res.status(400).json({ error: 'No account found with this email' });
        }

        // Rate limit: 60 seconds between requests
        const existing = otpStore.get(email);
        if (existing && (Date.now() - (existing.createdAt || 0)) < 60000) {
            return res.status(429).json({ error: 'Please wait before requesting another code' });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Store with 5-minute expiry
        otpStore.set(email, {
            code,
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: Date.now(),
            verified: false
        });

        // Send email
        await sendVerificationCode(email, code);

        res.json({ success: true, message: 'Verification code sent to your email' });
    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ error: 'Failed to send verification code. Check email settings.' });
    }
});

// Step 2: Verify the code
router.post('/forgot-password/verify-code', async (req, res) => {
    try {
        let { email, code } = req.body;
        email = email?.trim().toLowerCase();
        code = code?.trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const stored = otpStore.get(email);

        if (!stored) {
            return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
        }

        if (Date.now() > stored.expiresAt) {
            otpStore.delete(email);
            return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
        }

        if (stored.code !== code) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // Mark as verified
        stored.verified = true;
        otpStore.set(email, stored);

        res.json({ success: true, message: 'Code verified successfully' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Step 3: Reset password (only after code is verified)
router.post('/forgot-password/reset', async (req, res) => {
    try {
        let { email, newPassword } = req.body;
        email = email?.trim().toLowerCase();

        if (!email || !newPassword) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if code was verified
        const stored = otpStore.get(email);
        if (!stored || !stored.verified) {
            return res.status(403).json({ error: 'Email not verified. Please complete verification first.' });
        }

        // Hash and update password
        const hash = await bcrypt.hash(newPassword, 10);
        const { error: dbError } = await supabase
            .from('users')
            .update({ password: hash })
            .eq('email', email);

        if (dbError) {
            return res.status(500).json({ error: 'Database update failed' });
        }

        // Remove OTP after successful reset
        otpStore.delete(email);

        res.json({ success: true, message: 'Password reset successful!' });
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
