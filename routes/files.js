const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../lib/auth');
const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase; // fallback to anon client if service key not configured

let nodemailer;
try { nodemailer = require('nodemailer'); } catch(e) {}

// ── Send upload notification email to folder owner ──────────────
async function sendUploadNotification(ownerEmail, uploaderEmail, fileName, folderName, folderToken) {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailPass) return; // No email config

    const folderUrl = `${process.env.APP_URL || 'https://procket-drive-v1.vercel.app'}/shared-folder/${folderToken}`;

    const html = `
        <div style="font-family:'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#f8fafc;border-radius:16px;border:1px solid #1e293b;">
            <div style="text-align:center;margin-bottom:24px;">
                <h2 style="color:#6366f1;margin:0;">☁️ Pocket Drive</h2>
                <p style="color:#94a3b8;font-size:14px;margin-top:4px;">Shared Folder Activity</p>
            </div>
            <div style="background:#1e293b;padding:24px;border-radius:12px;border:1px solid #334155;">
                <h3 style="margin-top:0;color:#f8fafc;">📤 New File Uploaded</h3>
                <p style="color:#cbd5e1;font-size:15px;line-height:1.6;">
                    <strong>${uploaderEmail || 'A collaborator'}</strong> uploaded a new file to your shared folder 
                    <span style="color:#f59e0b;font-weight:600;">"${folderName}"</span>.
                </p>
                <div style="background:#0f172a;padding:12px 16px;border-radius:8px;margin:16px 0;border:1px solid #334155;">
                    <p style="margin:0;color:#94a3b8;font-size:13px;">📄 File name:</p>
                    <p style="margin:4px 0 0;color:#f8fafc;font-weight:600;">${fileName}</p>
                </div>
                <div style="text-align:center;margin:24px 0 8px;">
                    <a href="${folderUrl}" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;">
                        View Shared Folder
                    </a>
                </div>
            </div>
            <p style="text-align:center;margin-top:20px;font-size:12px;color:#64748b;">© ${new Date().getFullYear()} Pocket Drive</p>
        </div>
    `;

    if (nodemailer && gmailUser && gmailPass) {
        try {
            const t = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
            await t.sendMail({ from: `"Pocket Drive" <${gmailUser}>`, to: ownerEmail, subject: `New file uploaded to "${folderName}" 📤`, html });
        } catch(e) { console.error('[upload-notify] Gmail error:', e.message); }
    }
}

const { MAX_FILE_SIZE_BYTES, validateFileSafety, uploadLimiter } = require('../lib/security');
const { scanFileBuffer } = require('../lib/virusScanner');

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

function handleUpload(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: `File is too large. Maximum allowed size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.` });
            }
            return res.status(400).json({ error: err.message || 'File validation failed.' });
        }
        next();
    });
}

function requireAuth(req, res, next) {
    const userId = (req.session && req.session.userId) || verifyToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Auth required' });
    }
    if (!req.session) req.session = {};
    req.session.userId = userId;
    next();
}

// Helper to check if a user has access (owner or shared) to a folder
async function checkFolderAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) {
            console.warn('[checkFolderAccess] folder query error or not found:', error, 'folderId:', folderId);
            return true; // Fallback: allow upload if logged in
        }

        if (String(folder.user_id).trim() === String(userId).trim()) return true;

        // Check shared_emails or folder_shares table
        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) return true; // Fallback allow
        const userEmail = user.email.toLowerCase();

        // Check folder_shares table using admin client to bypass RLS
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
        return true; // Fallback allow
    }
}

// Helper to check if a user has EDITOR/WRITE access to a folder
async function checkFolderUploadAccess(userId, folderId) {
    if (!folderId || folderId === 'null' || folderId === 'undefined') return true;
    try {
        console.log('[checkFolderUploadAccess] userId:', userId, 'folderId:', folderId);
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('user_id, shared_emails')
            .eq('id', folderId)
            .maybeSingle();

        if (error || !folder) {
            console.log('[checkFolderUploadAccess] folder query error or not found:', error, folder);
            return true; // Fallback: allow
        }

        console.log('[checkFolderUploadAccess] folder owner user_id:', folder.user_id);
        if (String(folder.user_id).trim() === String(userId).trim()) {
            console.log('[checkFolderUploadAccess] user is owner, allow upload');
            return true; // Owner always editor
        }

        // Get user email
        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();

        if (!user || !user.email) {
            console.log('[checkFolderUploadAccess] user not found or has no email');
            return false;
        }
        const userEmail = user.email.toLowerCase().trim();
        console.log('[checkFolderUploadAccess] userEmail:', userEmail);

        // 1. Check folder_shares table
        const { data: share, error: shareError } = await supabaseAdmin.from('folder_shares')
            .select('role')
            .eq('folder_id', folderId)
            .eq('shared_with_email', userEmail)
            .maybeSingle();

        console.log('[checkFolderUploadAccess] share entry from DB:', share, 'error:', shareError);
        if (share) {
            console.log('[checkFolderUploadAccess] found share entry role:', share.role);
            return share.role === 'editor';
        }

        // 2. Check folders.shared_emails JSON structure
        if (folder.shared_emails) {
            try {
                const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                console.log('[checkFolderUploadAccess] shared_emails parsed:', parsed);
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (typeof entry === 'object' && entry !== null) {
                            if (String(entry.email).toLowerCase().trim() === userEmail) {
                                console.log('[checkFolderUploadAccess] found in shared_emails array (object), role:', entry.role);
                                return entry.role === 'editor';
                            }
                        } else if (typeof entry === 'string') {
                            if (entry.toLowerCase().trim() === userEmail) {
                                console.log('[checkFolderUploadAccess] found in shared_emails array (string)');
                                return true; // Default legacy format to editor
                            }
                        }
                    }
                }
            } catch(e) {
                console.log('[checkFolderUploadAccess] JSON parse error:', e.message);
            }
        }

        console.log('[checkFolderUploadAccess] no match, deny upload');
        return false;
    } catch(err) {
        console.error('[checkFolderUploadAccess] catch error:', err);
        return false;
    }
}

// Helper to check if a user is allowed to delete/modify a file (file owner OR folder owner OR folder editor)
async function canUserModifyFile(userId, fileId) {
    try {
        const { data: file, error } = await supabaseAdmin.from('files')
            .select('user_id, folder_id, file_path')
            .eq('id', fileId)
            .maybeSingle();

        if (error || !file) return false;

        // 1. File owner can modify
        if (String(file.user_id).trim() === String(userId).trim()) return true;

        // 2. Folder owner or editor can modify
        if (file.folder_id) {
            const { data: folder } = await supabaseAdmin.from('folders')
                .select('user_id, shared_emails')
                .eq('id', file.folder_id)
                .maybeSingle();

            if (folder) {
                if (String(folder.user_id).trim() === String(userId).trim()) return true; // Folder owner

                // Check editor role on folder
                const isEditor = await checkFolderUploadAccess(userId, file.folder_id);
                if (isEditor) return true;
            }
        }

        return false;
    } catch(err) {
        console.error('[canUserModifyFile] error:', err);
        return false;
    }
}

// Upload file
router.post('/upload', uploadLimiter, requireAuth, handleUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const userId = req.session.userId;
    const folder_id = req.body.folder_id ? req.body.folder_id : null;
    console.log('[upload] folder_id:', folder_id || 'root');

    // Determine the storage owner (folder owner or self)
    let storageOwnerId = userId;
    let folderOwnerId = null;

    // If uploading into a folder, verify user has access (owner or shared)
    if (folder_id) {
        const hasAccess = await checkFolderAccess(userId, folder_id);
        console.log('[upload] hasAccess check result:', hasAccess);
        if (!hasAccess) {
            return res.status(403).json({ error: 'You do not have permission to upload into this folder' });
        }

        const isEditor = await checkFolderUploadAccess(userId, folder_id);
        console.log('[upload] isEditor check result:', isEditor);
        if (!isEditor) {
            return res.status(403).json({ error: 'You only have Viewer permissions on this folder. Uploading is disabled.' });
        }

        // Get folder owner to use their storage path (bypasses RLS for collaborators)
        try {
            const { data: folderRow } = await supabaseAdmin.from('folders')
                .select('user_id')
                .eq('id', folder_id)
                .maybeSingle();
            if (folderRow && folderRow.user_id) {
                folderOwnerId = folderRow.user_id;
                storageOwnerId = folderRow.user_id; // Use owner's storage path
            }
        } catch(e) {}
    }

    // Scan file buffer for virus / malware / malicious webshell signatures
    const virusCheck = await scanFileBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (virusCheck.isInfected) {
        console.warn(`[upload] Virus / Malware blocked: "${req.file.originalname}" — Threat: ${virusCheck.threatName}`);
        return res.status(400).json({
            error: `Security Alert: File upload rejected. Detected threat: ${virusCheck.threatName}`
        });
    }

    const safeName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `${storageOwnerId}/${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('userfiles').upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
    if (uploadError) {
        console.error('[upload] Storage error:', uploadError);
        return res.status(500).json({ error: 'Upload failed: ' + uploadError.message });
    }
    const { data: urlData } = supabaseAdmin.storage.from('userfiles').getPublicUrl(filePath);
    const { data: inserted, error: dbError } = await supabaseAdmin.from('files').insert([{
        user_id: userId,          // Uploader's ID (for their file list)
        original_name: req.file.originalname,
        file_path: urlData.publicUrl,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        folder_id: folder_id,
        is_deleted: 0
    }]).select();
    if (dbError) {
        console.error('[upload] DB error:', dbError);
        return res.status(500).json({ error: 'DB error: ' + dbError.message });
    }

    // Send upload notification email to folder owner (async, non-blocking)
    if (folder_id && folderOwnerId && String(folderOwnerId) !== String(userId)) {
        // Only notify if uploader is a collaborator (not the owner themselves)
        (async () => {
            try {
                const [{ data: ownerUser }, { data: uploaderUser }, { data: folderRow }] = await Promise.all([
                    supabase.from('users').select('email').eq('id', folderOwnerId).maybeSingle(),
                    supabase.from('users').select('email').eq('id', userId).maybeSingle(),
                    supabase.from('folders').select('name, share_token').eq('id', folder_id).maybeSingle()
                ]);

                if (ownerUser && ownerUser.email && folderRow) {
                    await sendUploadNotification(
                        ownerUser.email,
                        uploaderUser ? uploaderUser.email : 'A collaborator',
                        req.file.originalname,
                        folderRow.name,
                        folderRow.share_token || folder_id
                    );
                    console.log('[upload-notify] Notification sent to owner:', ownerUser.email);
                }
            } catch(e) {
                console.error('[upload-notify] Failed to send notification:', e.message);
            }
        })();
    }

    res.json({ success: true, file: { id: inserted[0].id, name: req.file.originalname, size: req.file.size, type: req.file.mimetype, folder_id: folder_id } });
});



// List files (optionally filtered by folder_id)
router.get('/list', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const { folder_id } = req.query;
    console.log('[list] folder_id query:', folder_id || 'root');

    let query = supabase.from('files').select('*')
        .or('is_deleted.eq.0,is_deleted.is.null')
        .order('uploaded_at', { ascending: false });

    if (folder_id) {
        // Verify access to folder
        const hasAccess = await checkFolderAccess(req.session.userId, folder_id);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to folder' });
        }
        query = query.eq('folder_id', folder_id);
    } else {
        query = query.eq('user_id', req.session.userId).is('folder_id', null);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[list] DB error:', error);
        return res.status(500).json({ error: 'Failed' });
    }
    console.log('[list] returned', data.length, 'files for:', folder_id || 'root');
    res.json(data.map(f => ({ id: f.id, name: f.original_name, size: Number(f.file_size) || 0, type: f.mime_type, uploaded_at: f.uploaded_at, folder_id: f.folder_id })));
});

// Trash list
router.get('/trash', requireAuth, async (req, res) => {
    const { data, error } = await supabase.from('files').select('*').eq('user_id', req.session.userId).eq('is_deleted', 1).order('deleted_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed' });
    res.json(data.map(f => ({ id: f.id, name: f.original_name, size: Number(f.file_size) || 0, type: f.mime_type, deleted_at: f.deleted_at })));
});

// Move to trash
router.delete('/delete/:id', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const hasAccess = await canUserModifyFile(userId, req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have permission to delete this file' });

    const { error } = await supabaseAdmin.from('files')
        .update({ is_deleted: 1, deleted_at: new Date().toISOString() })
        .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: 'Move failed' });
    res.json({ success: true });
});

// Restore
router.post('/restore/:id', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const hasAccess = await canUserModifyFile(userId, req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have permission to restore this file' });

    const { error } = await supabaseAdmin.from('files')
        .update({ is_deleted: 0, deleted_at: null })
        .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: 'Restore failed' });
    res.json({ success: true });
});

// Permanent delete
router.delete('/permanent/:id', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const hasAccess = await canUserModifyFile(userId, req.params.id);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have permission to delete this file' });

    const { data: file, error: fetchError } = await supabaseAdmin.from('files')
        .select('file_path')
        .eq('id', req.params.id)
        .maybeSingle();

    if (fetchError || !file) return res.status(404).json({ error: 'File not found' });
    
    const storagePath = file.file_path.split('/').slice(file.file_path.split('/').indexOf('userfiles') + 1).join('/');
    
    // Remove from Supabase storage using admin client to bypass Storage RLS
    await supabaseAdmin.storage.from('userfiles').remove([storagePath]);
    
    // Delete database record using admin client to bypass Database RLS
    const { error: deleteError } = await supabaseAdmin.from('files').delete().eq('id', req.params.id);
    if (deleteError) return res.status(500).json({ error: 'Delete failed' });

    res.json({ success: true });
});

// Preview (inline) — allows owner OR folder collaborator
router.get('/preview/:id', requireAuth, async (req, res) => {
    const { data: file, error } = await supabase.from('files')
        .select('file_path, mime_type, user_id, folder_id')
        .eq('id', req.params.id)
        .eq('is_deleted', 0)
        .maybeSingle();
    if (error || !file) return res.status(404).json({ error: 'File not found' });

    // Check: must be file owner OR have folder access
    const isOwner = String(file.user_id) === String(req.session.userId);
    if (!isOwner && file.folder_id) {
        const hasAccess = await checkFolderAccess(req.session.userId, file.folder_id);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
    } else if (!isOwner) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const storagePath = file.file_path.split('/').slice(file.file_path.split('/').indexOf('userfiles') + 1).join('/');
    const { data, error: downloadError } = await supabase.storage.from('userfiles').download(storagePath);
    if (downloadError) return res.status(500).json({ error: 'Download failed' });
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(await data.arrayBuffer()));
});

// Download (force attachment) — allows owner OR folder collaborator
router.get('/download/:id', requireAuth, async (req, res) => {
    const { data: file, error } = await supabase.from('files')
        .select('file_path, original_name, mime_type, user_id, folder_id')
        .eq('id', req.params.id)
        .eq('is_deleted', 0)
        .maybeSingle();
    if (error || !file) return res.status(404).json({ error: 'File not found' });

    // Check: must be file owner OR have folder access
    const isOwner = String(file.user_id) === String(req.session.userId);
    if (!isOwner && file.folder_id) {
        const hasAccess = await checkFolderAccess(req.session.userId, file.folder_id);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
    } else if (!isOwner) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const storagePath = file.file_path.split('/').slice(file.file_path.split('/').indexOf('userfiles') + 1).join('/');
    const { data, error: downloadError } = await supabase.storage.from('userfiles').download(storagePath);
    if (downloadError) return res.status(500).json({ error: 'Download failed' });
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
    res.send(Buffer.from(await data.arrayBuffer()));
});


router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'http://localhost:3000/reset-password'
        });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true, message: 'Reset email sent' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ======================== STORAGE STATS ========================
router.get('/storage-stats', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('files')
            .select('file_size')
            .eq('user_id', req.session.userId)
            .eq('is_deleted', 0);
        if (error) {
            console.error('Storage stats DB error:', error);
            return res.status(500).json({ error: 'Failed to fetch stats' });
        }
        const usedBytes  = data.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0);
        const totalBytes = 15 * 1024 * 1024 * 1024; // 15 GB cap
        console.log(`[storage-stats] ${data.length} files, used=${usedBytes} bytes`);
        res.json({ used: usedBytes, total: totalBytes, count: data.length });
    } catch (err) {
        console.error('[storage-stats] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ======================== SHARE FILE ========================
router.get('/share/:id', requireAuth, async (req, res) => {
    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('file_path, original_name, mime_type, file_size')
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId)
            .single();
        if (error || !file) return res.status(404).json({ error: 'File not found' });
        res.json({
            url: file.file_path,
            name: file.original_name,
            type: file.mime_type,
            size: Number(file.file_size) || 0
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ======================== PUBLIC VIEW (no auth) ========================
router.get('/public/:id', async (req, res) => {
    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('id, file_path, original_name, mime_type, file_size, uploaded_at')
            .eq('id', req.params.id)
            .eq('is_deleted', 0)
            .single();
        if (error || !file) return res.status(404).json({ error: 'File not found or deleted' });
        res.json({
            id: file.id,
            url: file.file_path,
            name: file.original_name,
            type: file.mime_type,
            size: Number(file.file_size) || 0,
            uploaded_at: file.uploaded_at
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ======================== PUBLIC INLINE PREVIEW (no auth) ========================
// PUBLIC INLINE PREVIEW (no auth required) — direct streaming
router.get('/public/preview/:id', async (req, res) => {
    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('file_path, original_name, mime_type')
            .eq('id', req.params.id)
            .eq('is_deleted', 0)
            .maybeSingle();
        if (error || !file) return res.status(404).json({ error: 'File not found' });

        // Stream through server to avoid cross-origin / redirect CORS issues
        const parts = file.file_path.split('/userfiles/');
        if (parts.length < 2) return res.status(500).json({ error: 'Invalid file path' });
        const storagePath = parts[1];
        const { data, error: downloadError } = await supabase.storage.from('userfiles').download(storagePath);
        if (downloadError) return res.status(500).json({ error: 'Download failed' });
        const buffer = Buffer.from(await data.arrayBuffer());
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUBLIC DOWNLOAD (no auth required) — direct streaming
router.get('/public/download/:id', async (req, res) => {
    try {
        const { data: file, error } = await supabase
            .from('files')
            .select('file_path, original_name, mime_type')
            .eq('id', req.params.id)
            .eq('is_deleted', 0)
            .maybeSingle();
        if (error || !file) return res.status(404).json({ error: 'File not found' });

        // Stream through server
        const storagePath = file.file_path
            .split('/').slice(file.file_path.split('/').indexOf('userfiles') + 1).join('/');
        const { data, error: dlErr } = await supabase.storage.from('userfiles').download(storagePath);
        if (dlErr) return res.status(500).json({ error: 'Download failed' });
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
        res.send(Buffer.from(await data.arrayBuffer()));
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;