const bcrypt = require('bcryptjs');

const VAULT_FOLDER_NAME = '__pd_vault__';

// In-memory cache for vault folder lookups to eliminate redundant DB calls
const vaultFolderCache = new Map();
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function invalidateVaultFolderCache(userId) {
    if (userId) vaultFolderCache.delete(String(userId));
}

// Helper to find existing vault folder
async function getVaultFolder(supabaseAdmin, userId) {
    if (!userId) return null;
    const cacheKey = String(userId);
    const cached = vaultFolderCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
        return cached.folder;
    }

    try {
        const { data, error } = await supabaseAdmin.from('folders')
            .select('id, name, share_token, shared_emails, user_id')
            .eq('user_id', userId)
            .eq('name', VAULT_FOLDER_NAME)
            .maybeSingle();

        if (error) {
            console.error('[vault] getVaultFolder error:', error);
            return null;
        }
        vaultFolderCache.set(cacheKey, { folder: data, expiresAt: now + VAULT_CACHE_TTL_MS });
        return data;
    } catch (e) {
        console.error('[vault] getVaultFolder catch:', e);
        return null;
    }
}

// Helper to get or create vault folder
async function getOrCreateVaultFolder(supabaseAdmin, userId) {
    let folder = await getVaultFolder(supabaseAdmin, userId);
    if (folder) return folder;

    try {
        const { data, error } = await supabaseAdmin.from('folders')
            .insert([{
                user_id: userId,
                name: VAULT_FOLDER_NAME,
                is_shared: false,
                share_token: null,
                shared_emails: null
            }])
            .select()
            .single();

        if (error) {
            console.error('[vault] createVaultFolder error:', error);
            return null;
        }
        invalidateVaultFolderCache(userId);
        return data;
    } catch (e) {
        console.error('[vault] createVaultFolder catch:', e);
        return null;
    }
}

// Check if user has set up a PIN
async function isVaultSetup(supabaseAdmin, userId) {
    const folder = await getVaultFolder(supabaseAdmin, userId);
    if (!folder) return false;
    // Check if share_token has a hashed PIN
    return !!(folder.share_token && folder.share_token.startsWith('$2'));
}

// Set up or change PIN
async function setupVaultPin(supabaseAdmin, userId, pin) {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        throw new Error('PIN must be exactly 4 digits');
    }

    const hash = await bcrypt.hash(pin, 10);
    let folder = await getVaultFolder(supabaseAdmin, userId);

    if (!folder) {
        const { data, error } = await supabaseAdmin.from('folders')
            .insert([{
                user_id: userId,
                name: VAULT_FOLDER_NAME,
                is_shared: false,
                share_token: hash,
                shared_emails: JSON.stringify({ vault_pin: hash })
            }])
            .select()
            .single();

        if (error) throw new Error('Failed to create vault in database: ' + error.message);
        invalidateVaultFolderCache(userId);
        return data;
    } else {
        const { data, error } = await supabaseAdmin.from('folders')
            .update({
                share_token: hash,
                shared_emails: JSON.stringify({ vault_pin: hash })
            })
            .eq('id', folder.id)
            .select()
            .single();

        if (error) throw new Error('Failed to update vault PIN: ' + error.message);
        invalidateVaultFolderCache(userId);
        return data;
    }
}

// Verify PIN
async function verifyVaultPin(supabaseAdmin, userId, pin) {
    if (!pin) return false;
    const folder = await getVaultFolder(supabaseAdmin, userId);
    if (!folder || !folder.share_token) return false;

    try {
        return await bcrypt.compare(String(pin), folder.share_token);
    } catch (e) {
        console.error('[vault] verify PIN error:', e);
        return false;
    }
}

// Get files inside the vault
async function getVaultFiles(supabaseAdmin, userId) {
    const folder = await getVaultFolder(supabaseAdmin, userId);
    if (!folder) return [];

    try {
        const { data, error } = await supabaseAdmin.from('files')
            .select('id, original_name, file_size, mime_type, uploaded_at, folder_id, file_path')
            .eq('user_id', userId)
            .eq('folder_id', folder.id)
            .or('is_deleted.eq.0,is_deleted.is.null')
            .order('original_name', { ascending: true });

        if (error) {
            console.error('[vault] getVaultFiles error:', error);
            return [];
        }

        return (data || []).map(f => ({
            id: f.id,
            name: f.original_name,
            size: Number(f.file_size) || 0,
            type: f.mime_type,
            uploaded_at: f.uploaded_at,
            folder_id: f.folder_id,
            is_vault: true
        }));
    } catch (e) {
        console.error('[vault] getVaultFiles catch:', e);
        return [];
    }
}

// Toggle file in/out of vault
async function toggleVaultFile(supabaseAdmin, userId, fileId) {
    const folder = await getOrCreateVaultFolder(supabaseAdmin, userId);
    if (!folder) throw new Error('Could not initialize vault folder');

    // Find the file
    const { data: file, error: fetchErr } = await supabaseAdmin.from('files')
        .select('id, original_name, folder_id, user_id')
        .eq('id', fileId)
        .eq('user_id', userId)
        .maybeSingle();

    if (fetchErr || !file) {
        throw new Error('File not found or permission denied');
    }

    const isInVault = String(file.folder_id) === String(folder.id);
    const newFolderId = isInVault ? null : folder.id;

    const { data: updated, error: updateErr } = await supabaseAdmin.from('files')
        .update({ folder_id: newFolderId })
        .eq('id', fileId)
        .select()
        .single();

    if (updateErr) {
        throw new Error('Failed to update file vault status: ' + updateErr.message);
    }

    return {
        inVault: !isInVault,
        file: {
            id: updated.id,
            name: updated.original_name,
            folder_id: updated.folder_id
        }
    };
}

// Batch migrate legacy localStorage files into vault
async function migrateLegacyFiles(supabaseAdmin, userId, fileIds) {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return { migrated: 0 };
    const folder = await getOrCreateVaultFolder(supabaseAdmin, userId);
    if (!folder) return { migrated: 0 };

    try {
        const { error } = await supabaseAdmin.from('files')
            .update({ folder_id: folder.id })
            .eq('user_id', userId)
            .in('id', fileIds)
            .is('folder_id', null);

        if (error) console.error('[vault] migration error:', error);
        return { success: true };
    } catch (e) {
        console.error('[vault] migration catch:', e);
        return { success: false };
    }
}

// Reset PIN using account password
async function resetVaultPinWithPassword(supabaseAdmin, userId, accountPassword, newPin) {
    if (!accountPassword) throw new Error('Account password is required');
    if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        throw new Error('New PIN must be exactly 4 digits');
    }

    // Verify user account password
    const { data: user, error } = await supabaseAdmin.from('users')
        .select('id, password')
        .eq('id', userId)
        .single();

    if (error || !user) throw new Error('User account not found');

    const passMatch = await bcrypt.compare(accountPassword, user.password);
    if (!passMatch) throw new Error('Incorrect account password');

    // Hash and set new PIN
    return await setupVaultPin(supabaseAdmin, userId, newPin);
}

module.exports = {
    VAULT_FOLDER_NAME,
    getVaultFolder,
    getOrCreateVaultFolder,
    isVaultSetup,
    setupVaultPin,
    verifyVaultPin,
    getVaultFiles,
    toggleVaultFile,
    migrateLegacyFiles,
    resetVaultPinWithPassword
};
