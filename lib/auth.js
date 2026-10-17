const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-secret-in-production';
const COOKIE_NAME = 'pd_token';
const MAX_AGE     = 24 * 60 * 60; // 24 hours in seconds

// Sign JWT
function signToken(userId) {
    return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '24h' });
}

// Verify JWT from cookie, auth header, or query param
function verifyToken(req) {
    try {
        let token = null;

        // Try cookie first
        const cookieHeader = req.headers?.cookie || '';
        const match = cookieHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(COOKIE_NAME + '='));

        if (match) {
            token = match.split('=').slice(1).join('=');
        }

        // Fallback to Bearer token
        if (!token && req.headers?.authorization) {
            const parts = req.headers.authorization.split(' ');
            if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
                token = parts[1];
            }
        }

        // Fallback to query param (e.g. for direct downloads / streaming)
        if (!token && req.query && req.query.token) {
            token = req.query.token;
        }

        if (!token) return null;

        const payload = jwt.verify(token, JWT_SECRET);
        return payload.uid;
    } catch {
        return null;
    }
}

// Helper to safely append Set-Cookie header without overwriting previous cookies
function appendCookie(res, cookieStr) {
    try {
        if (typeof res.append === 'function') {
            res.append('Set-Cookie', cookieStr);
            return;
        }
        const existing = res.getHeader('Set-Cookie');
        if (existing) {
            const arr = Array.isArray(existing) ? existing : [existing];
            res.setHeader('Set-Cookie', [...arr, cookieStr]);
        } else {
            res.setHeader('Set-Cookie', cookieStr);
        }
    } catch {
        res.setHeader('Set-Cookie', cookieStr);
    }
}

// Set cookie
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

    appendCookie(res, cookieOptions);
}

// Clear cookie
function clearTokenCookie(res) {
    const cookieOptions = [
        `${COOKIE_NAME}=`,
        'Max-Age=0',
        'Path=/',
        'HttpOnly',
    ].join('; ');
    appendCookie(res, cookieOptions);
}

// Auth middleware guard
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

// ── Private Vault Session / Token Helpers ───────────────
const VAULT_COOKIE_NAME = 'pd_vault_token';
const VAULT_MAX_AGE     = 15 * 60; // 15 minutes session

function signVaultToken(userId) {
    return jwt.sign({ uid: userId, vault: true }, JWT_SECRET, { expiresIn: '15m' });
}

function verifyVaultToken(req) {
    try {
        let token = null;
        const cookieHeader = req.headers?.cookie || '';
        const match = cookieHeader
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(VAULT_COOKIE_NAME + '='));

        if (match) {
            token = match.split('=').slice(1).join('=');
        }

        if (!token && req.headers?.['x-vault-token']) {
            token = req.headers['x-vault-token'];
        }

        if (!token && req.query && (req.query.vault_token || req.query.vaultToken)) {
            token = req.query.vault_token || req.query.vaultToken;
        }

        if (!token) return null;

        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.vault && payload.uid) {
            return payload.uid;
        }
        return null;
    } catch {
        return null;
    }
}

function setVaultTokenCookie(res, token) {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
        `${VAULT_COOKIE_NAME}=${token}`,
        `Max-Age=${VAULT_MAX_AGE}`,
        'Path=/',
        'HttpOnly',
        isProduction ? 'Secure' : '',
        isProduction ? 'SameSite=None' : 'SameSite=Lax',
    ].filter(Boolean).join('; ');

    appendCookie(res, cookieOptions);
}

function clearVaultTokenCookie(res) {
    const cookieOptions = [
        `${VAULT_COOKIE_NAME}=`,
        'Max-Age=0',
        'Path=/',
        'HttpOnly',
    ].join('; ');
    appendCookie(res, cookieOptions);
}

function requireVaultAuth(req, res, next) {
    const userId = verifyToken(req) || (req.session && req.session.userId);
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const vaultUserId = verifyVaultToken(req) || (req.session && req.session.vaultUnlocked ? userId : null);
    if (!vaultUserId || String(vaultUserId) !== String(userId)) {
        return res.status(403).json({ error: 'Vault is locked. Please enter your PIN.' });
    }

    req.userId = userId;
    req.vaultUnlocked = true;
    if (typeof next === 'function') {
        return next();
    }
    return true;
}

module.exports = {
    signToken,
    verifyToken,
    setTokenCookie,
    clearTokenCookie,
    requireAuth,
    signVaultToken,
    verifyVaultToken,
    setVaultTokenCookie,
    clearVaultTokenCookie,
    requireVaultAuth
};

