const multer   = require('multer');
const { createClient } = require('@supabase/supabase-js');
const supabase  = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase;

const { MAX_FILE_SIZE_BYTES, validateFileSafety } = require('../../lib/security');

function setCors(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        const check = validateFileSafety(file.originalname);
        if (!check.allowed) {
            return cb(new Error(check.reason), false);
        }
        cb(null, true);
    }
});

function runMiddleware(req, res, fn) {
    return new Promise((resolve, reject) => {
        fn(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });
}

// Helper to check if a user has access (owner or shared) to a folder
async function checkFolderAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) return true; // Fallback: allow

        if (String(folder.user_id).trim() === String(userId).trim()) return true;

        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) return true;
        const userEmail = user.email.toLowerCase().trim();

        // Check folder_shares table
        const { data: share } = await supabaseAdmin.from('folder_shares')
            .select('id')
            .eq('folder_id', folderId)
            .eq('shared_with_email', userEmail)
            .maybeSingle();

        if (share) return true;

        if (folder.shared_emails) {
            try {
                const emails = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(emails)) {
                    for (const entry of emails) {
                        if (typeof entry === 'object' && entry !== null) {
                            if (String(entry.email).toLowerCase().trim() === userEmail) {
                                return true;
                            }
                        } else if (typeof entry === 'string') {
                            if (entry.toLowerCase().trim() === userEmail) {
                                return true;
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        return false;
    } catch(err) {
        console.error('[checkFolderAccess] catch error:', err);
        return true;
    }
}

// Helper to check if a user has EDITOR/WRITE access to a folder
async function checkFolderUploadAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) return true;

        if (String(folder.user_id).trim() === String(userId).trim()) return true;

        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) return false;
        const userEmail = user.email.toLowerCase().trim();

        // 1. Check folder_shares table
        const { data: share } = await supabaseAdmin.from('folder_shares')
            .select('role')
            .eq('folder_id', folderId)
            .eq('shared_with_email', userEmail)
            .maybeSingle();

        if (share) return share.role === 'editor';

        // 2. Check folders.shared_emails JSON
        if (folder.shared_emails) {
            try {
                const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (typeof entry === 'object' && entry !== null) {
                            if (String(entry.email).toLowerCase().trim() === userEmail) {
                                return entry.role === 'editor';
                            }
                        } else if (typeof entry === 'string') {
                            if (entry.toLowerCase().trim() === userEmail) {
                                return true;
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        return false;
    } catch(err) {
        console.error('[checkFolderUploadAccess] error:', err);
        return false;
    }
}

async function handler(req, res) {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
        await runMiddleware(req, res, upload.single('file'));

        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const rawFolderId = req.body.folder_id;
        const validFolderId = (rawFolderId && rawFolderId !== 'null' && rawFolderId !== 'undefined') ? rawFolderId : null;

        // Determine the storage owner (folder owner or self)
        let storageOwnerId = userId;

        if (validFolderId) {
            const hasAccess = await checkFolderAccess(userId, validFolderId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'You do not have permission to upload into this folder' });
            }

            const isEditor = await checkFolderUploadAccess(userId, validFolderId);
            if (!isEditor) {
                return res.status(403).json({ error: 'You only have Viewer permissions on this folder. Uploading is disabled.' });
            }

            // Get folder owner for storage ID path
            try {
                const { data: folderRow } = await supabaseAdmin.from('folders')
                    .select('user_id')
                    .eq('id', validFolderId)
                    .maybeSingle();
                if (folderRow && folderRow.user_id) {
                    storageOwnerId = folderRow.user_id;
                }
            } catch(e) {}
        }

        // Build safe storage path: storageOwnerId/timestamp-safename
        const safeName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const filePath = `${storageOwnerId}/${safeName}`;

        // Upload to Supabase Storage bucket "userfiles" via admin client to bypass Storage RLS
        const { error: uploadError } = await supabaseAdmin.storage
            .from('userfiles')
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return res.status(500).json({ error: 'File upload failed: ' + uploadError.message });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage.from('userfiles').getPublicUrl(filePath);

        // Save metadata to DB via admin client to bypass Database RLS
        const { data: inserted, error: dbError } = await supabaseAdmin
            .from('files')
            .insert([{
                user_id:       userId,
                original_name: req.file.originalname,
                file_path:     urlData.publicUrl,
                file_size:     req.file.size,
                mime_type:     req.file.mimetype,
                folder_id:     validFolderId,
                is_deleted:    0
            }])
            .select()
            .single();

        if (dbError) {
            console.error('DB insert error:', dbError);
            return res.status(500).json({ error: 'Database error after upload' });
        }

        res.json({
            success: true,
            file: {
                id:          inserted.id,
                name:        req.file.originalname,
                size:        req.file.size,
                type:        req.file.mimetype,
                uploaded_at: inserted.uploaded_at
            }
        });
    } catch (err) {
        console.error('/files/upload error:', err);
        res.status(500).json({ error: 'Upload failed' });
    }
}

// config must be on the exported function — not overwritten by module.exports = fn
handler.config = { api: { bodyParser: false } };
module.exports = handler;
