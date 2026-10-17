const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
    requireAuth,
    requireVaultAuth,
    signVaultToken,
    setVaultTokenCookie,
    clearVaultTokenCookie,
    verifyVaultToken
} = require('../lib/auth');
const {
    isVaultSetup,
    setupVaultPin,
    verifyVaultPin,
    getVaultFiles,
    toggleVaultFile,
    migrateLegacyFiles,
    resetVaultPinWithPassword
} = require('../lib/vault');

const router = express.Router();

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// GET /api/vault/status - Check if vault PIN is setup and if currently unlocked
router.get('/status', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const setup = await isVaultSetup(supabaseAdmin, userId);

        let unlocked = false;
        if (setup) {
            const vaultUid = verifyVaultToken(req);
            unlocked = !!(vaultUid && String(vaultUid) === String(userId)) || !!(req.session && req.session.vaultUnlocked);
        }

        res.json({
            isSetup: setup,
            isUnlocked: unlocked
        });
    } catch (err) {
        console.error('[vault/status] error:', err);
        res.status(500).json({ error: 'Failed to check vault status' });
    }
});

// POST /api/vault/setup - Set initial 4-digit PIN
router.post('/setup', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { pin } = req.body;

        if (!pin || pin.length !== 4) {
            return res.status(400).json({ error: '4-digit PIN is required' });
        }

        await setupVaultPin(supabaseAdmin, userId, pin);

        // Mark unlocked
        if (req.session) req.session.vaultUnlocked = true;
        const vaultToken = signVaultToken(userId);
        setVaultTokenCookie(res, vaultToken);

        res.json({
            success: true,
            isSetup: true,
            isUnlocked: true,
            vaultToken
        });
    } catch (err) {
        console.error('[vault/setup] error:', err);
        res.status(500).json({ error: err.message || 'Failed to setup vault PIN' });
    }
});

// POST /api/vault/verify - Unlock vault with PIN
router.post('/verify', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { pin } = req.body;

        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }

        const isValid = await verifyVaultPin(supabaseAdmin, userId, pin);
        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Incorrect PIN. Please try again.' });
        }

        if (req.session) req.session.vaultUnlocked = true;
        const vaultToken = signVaultToken(userId);
        setVaultTokenCookie(res, vaultToken);

        res.json({
            success: true,
            isUnlocked: true,
            vaultToken
        });
    } catch (err) {
        console.error('[vault/verify] error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// GET /api/vault/files - List files in private vault
router.get('/files', requireVaultAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const files = await getVaultFiles(supabaseAdmin, userId);
        res.json(files);
    } catch (err) {
        console.error('[vault/files] error:', err);
        res.status(500).json({ error: 'Failed to load vault files' });
    }
});

// POST /api/vault/toggle - Move a file in/out of vault
router.post('/toggle', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { fileId } = req.body;

        if (!fileId) {
            return res.status(400).json({ error: 'fileId is required' });
        }

        const setup = await isVaultSetup(supabaseAdmin, userId);
        if (!setup) {
            return res.status(400).json({ error: 'Please setup your Vault PIN first' });
        }

        const result = await toggleVaultFile(supabaseAdmin, userId, fileId);
        res.json({
            success: true,
            inVault: result.inVault,
            file: result.file
        });
    } catch (err) {
        console.error('[vault/toggle] error:', err);
        res.status(500).json({ error: err.message || 'Failed to toggle vault file' });
    }
});

// POST /api/vault/migrate - One-time migration of local storage IDs to server vault
router.post('/migrate', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { fileIds } = req.body;

        if (Array.isArray(fileIds) && fileIds.length > 0) {
            await migrateLegacyFiles(supabaseAdmin, userId, fileIds);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[vault/migrate] error:', err);
        res.status(500).json({ error: 'Migration failed' });
    }
});

// POST /api/vault/reset - Reset PIN using account password
router.post('/reset', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { accountPassword, newPin } = req.body;

        if (!accountPassword || !newPin) {
            return res.status(400).json({ error: 'Account password and new PIN are required' });
        }

        await resetVaultPinWithPassword(supabaseAdmin, userId, accountPassword, newPin);

        if (req.session) req.session.vaultUnlocked = true;
        const vaultToken = signVaultToken(userId);
        setVaultTokenCookie(res, vaultToken);

        res.json({
            success: true,
            message: 'PIN successfully reset and vault unlocked'
        });
    } catch (err) {
        console.error('[vault/reset] error:', err);
        res.status(400).json({ error: err.message || 'Failed to reset PIN' });
    }
});

// POST /api/vault/lock - Lock the vault
router.post('/lock', requireAuth, async (req, res) => {
    if (req.session) req.session.vaultUnlocked = false;
    clearVaultTokenCookie(res);
    res.json({ success: true, isUnlocked: false });
});

module.exports = router;
