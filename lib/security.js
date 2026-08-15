// lib/security.js — Security configurations, rate limiting, and file validation
const rateLimit = require('express-rate-limit');
const path = require('path');

// Dangerous executable and script extensions to block for cloud storage safety
const BLOCKED_EXTENSIONS = new Set([
    '.exe', '.bat', '.cmd', '.sh', '.bash', '.vbs', '.vbe', '.js', '.jse',
    '.wsf', '.wsh', '.msc', '.msi', '.msp', '.com', '.scr', '.pif', '.application',
    '.gadget', '.hta', '.cpl', '.jar', '.reg', '.ps1', '.ps2', '.ps1xml', '.psc1', '.psc2'
]);

// Maximum file size in bytes (Default: 50 MB)
const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50) * 1024 * 1024;

/**
 * Validate if a file is safe to upload based on its extension
 * @param {string} originalname 
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateFileSafety(originalname) {
    if (!originalname || typeof originalname !== 'string') {
        return { allowed: false, reason: 'Invalid file name' };
    }
    
    const ext = path.extname(originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
        return { 
            allowed: false, 
            reason: `File type "${ext}" is not permitted for security reasons (executable/script files are restricted).` 
        };
    }
    
    return { allowed: true };
}

// ── Rate Limiters ─────────────────────────────────────────────────────────────

// Global API Limiter: 200 requests per 15 minutes
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

// Stricter Auth Limiter: 10 attempts per 15 minutes (for login, register, OTP)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait 15 minutes before trying again.' }
});

// Upload Limiter: 60 uploads per 15 minutes
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload rate limit exceeded. Please wait a few minutes before uploading more files.' }
});

module.exports = {
    BLOCKED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    validateFileSafety,
    apiLimiter,
    authLimiter,
    uploadLimiter
};
