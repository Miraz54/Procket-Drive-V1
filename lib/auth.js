const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-secret-in-production';
const COOKIE_NAME = 'pd_token';
const MAX_AGE     = 24 * 60 * 60; // 24 hours in seconds

// ─── Sign ────────────────────────────────────────────────────
function signToken(userId) {
    return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '24h' });
}

// ─── Verify (reads cookie from request) ──────────────────────
function verifyToken(req) {
    try {
        const cookieHeader = req.headers.cookie || '';
        const match = cookieHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(COOKIE_NAME + '='));

        if (!match) return null;

        const token = match.split('=').slice(1).join('=');
        const payload = jwt.verify(token, JWT_SECRET);
        return payload.uid;
    } catch {
        return null;
    }
}

// ─── Set cookie on response ───────────────────────────────────
function setTokenCookie(res, token) {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
        `${COOKIE_NAME}=${token}`,
        `Max-Age=${MAX_AGE}`,
        'Path=/',
        'HttpOnly',
        isProduction ? 'Secure' : '',
        isProduction ? 'SameSite=None' : 'SameSite=Lax',
    ].filter(Boolean).join('; ');

    res.setHeader('Set-Cookie', cookieOptions);
}

// ─── Clear cookie ─────────────────────────────────────────────
function clearTokenCookie(res) {
    const cookieOptions = [
        `${COOKIE_NAME}=`,
        'Max-Age=0',
        'Path=/',
        'HttpOnly',
    ].join('; ');
    res.setHeader('Set-Cookie', cookieOptions);
}

// ─── Middleware-style guard ───────────────────────────────────
function requireAuth(req, res) {
    const userId = verifyToken(req) || (req.session && req.session.userId);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    return userId;
}

module.exports = { signToken, verifyToken, setTokenCookie, clearTokenCookie, requireAuth };
