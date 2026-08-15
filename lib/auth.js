const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-secret-in-production';
const COOKIE_NAME = 'pd_token';
const MAX_AGE     = 24 * 60 * 60; // 24 hours in seconds

// ─── Sign JWT ────────────────────────────────────────────────
function signToken(userId) {
    return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '24h' });
}

// ─── Verify JWT (reads from HttpOnly cookie or Authorization header) ──────────
function verifyToken(req) {
    try {
        let token = null;

        // 1. Try reading from HttpOnly Cookie
        const cookieHeader = req.headers.cookie || '';
        const match = cookieHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(COOKIE_NAME + '='));

        if (match) {
            token = match.split('=').slice(1).join('=');
        }

        // 2. Fallback to Authorization: Bearer <token>
        if (!token && req.headers.authorization) {
            const parts = req.headers.authorization.split(' ');
            if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
                token = parts[1];
            }
        }

        if (!token) return null;

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

// ─── Pure JWT Middleware guard ────────────────────────────────
function requireAuth(req, res, next) {
    const userId = verifyToken(req) || (req.session && req.session.userId);
    if (!userId) {
        if (typeof next === 'function') {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        res.status(401).json({ error: 'Unauthorized. Please log in.' });
        return null;
    }

    req.userId = userId;
    if (req.session) req.session.userId = userId;

    if (typeof next === 'function') {
        return next();
    }
    return userId;
}

module.exports = { signToken, verifyToken, setTokenCookie, clearTokenCookie, requireAuth };
