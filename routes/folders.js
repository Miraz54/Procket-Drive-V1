const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { verifyToken } = require('../lib/auth');
const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Admin client — bypasses RLS for cross-user queries (e.g. shared-with-me)
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : supabase; // fallback to anon client if service key not configured

function requireAuth(req, res, next) {
    const userId = (req.session && req.session.userId) || verifyToken(req);
    if (!userId) {
        return res.status(401).json({ error: 'Auth required' });
    }
    if (!req.session) req.session = {};
    req.session.userId = userId;
    next();
}

// ── Create folder ───────────────────────────────────────────
router.post('/create', requireAuth, async (req, res) => {
    try {
        const { name, parent_id } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name required' });

        const userId = req.session.userId;
        const trimmedName = name.trim();

        // Check duplicate folder name in same directory
        let checkQuery = supabase.from('folders').select('id').eq('user_id', userId).ilike('name', trimmedName);
        if (parent_id) {
            checkQuery = checkQuery.eq('parent_id', parent_id);
        } else {
            checkQuery = checkQuery.is('parent_id', null);
        }
        const { data: existing } = await checkQuery;
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: `Folder "${trimmedName}" already exists` });
        }

        const { data, error } = await supabase.from('folders').insert([{
            user_id: userId,
            name: trimmedName,
            parent_id: parent_id || null
        }]).select().single();

        if (error) {
            console.error('[folders/create] Supabase error:', JSON.stringify(error));
            return res.status(500).json({ error: 'Failed to create folder' });
        }
        res.json({ success: true, folder: data });
    } catch (err) {
        console.error('[folders/create] catch:', err.message);
        res.status(500).json({ error: 'Server error', detail: err.message });
    }
});


// ── List folders (at root or inside a parent) ────────────────
router.get('/list', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const { parent_id } = req.query;
        let query = supabaseAdmin.from('folders')
            .select('id, name, is_shared, shared_emails, created_at, parent_id')
            .eq('user_id', req.session.userId)
            .order('created_at', { ascending: true });

        if (parent_id) {
            query = query.eq('parent_id', parent_id);
        } else {
            query = query.is('parent_id', null);
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: 'Failed to list folders' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Rename folder ────────────────────────────────────────────
router.patch('/rename/:id', requireAuth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

        const { error } = await supabase.from('folders')
            .update({ name: name.trim() })
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId);

        if (error) return res.status(500).json({ error: 'Rename failed' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Delete folder ────────────────────────────────────────────
router.delete('/delete/:id', requireAuth, async (req, res) => {
    try {
        // Move files in this folder to root (folder_id = null)
        await supabase.from('files')
            .update({ folder_id: null })
            .eq('folder_id', req.params.id);

        const { error } = await supabase.from('folders')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId);

        if (error) return res.status(500).json({ error: 'Delete failed' });
        res.json({ success: true });
    } catch (err) {
        console.error('[folders/delete] catch:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// ── Share folder — generates a public share token ────────────
router.post('/share/:id', requireAuth, async (req, res) => {
    try {
        const { data: folder, error: fetchErr } = await supabase.from('folders')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId)
            .single();

        if (fetchErr || !folder) return res.status(404).json({ error: 'Folder not found' });

        // Reuse existing token or generate new one
        let token = folder.share_token;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            await supabase.from('folders')
                .update({ is_shared: true, share_token: token })
                .eq('id', req.params.id);
        }

        res.json({
            success: true,
            token,
            shareUrl: `${req.protocol}://${req.get('host')}/shared-folder/${token}`,
            folderName: folder.name
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Public folder view (no auth) ─────────────────────────────
router.get('/public/:token', async (req, res) => {
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('id, name, created_at, shared_emails, user_id')
            .eq('share_token', req.params.token)
            .eq('is_shared', true)
            .single();

        if (error || !folder) return res.status(404).json({ error: 'Shared folder not found' });

        // Check if the current user has already accepted or is owner
        let alreadyAccepted = false;
        let userRole = 'viewer'; // Default to viewer
        const { verifyToken } = require('../lib/auth');
        const userId = verifyToken(req) || (req.session && req.session.userId);
        let userEmail = req.session && req.session.userEmail;

        if (userId) {
            if (String(folder.user_id) === String(userId)) {
                alreadyAccepted = true;
                userRole = 'editor'; // Owner is always editor
            } else {
                if (!userEmail) {
                    try {
                        const { data: u } = await supabaseAdmin.from('users').select('email').eq('id', userId).maybeSingle();
                        if (u) userEmail = u.email;
                    } catch(e) {}
                }

                if (userEmail) {
                    const emailNormalized = userEmail.toLowerCase().trim();
                    
                    // 1. Check folder_shares table
                    try {
                        const { data: share } = await supabaseAdmin.from('folder_shares')
                            .select('role')
                            .eq('folder_id', folder.id)
                            .eq('shared_with_email', emailNormalized)
                            .maybeSingle();
                        if (share) {
                            alreadyAccepted = true;
                            userRole = share.role || 'viewer';
                        }
                    } catch(e) {}

                    // 2. Check folders.shared_emails
                    if (!alreadyAccepted && folder.shared_emails) {
                        let emails = [];
                        try {
                            const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                            emails = Array.isArray(parsed) ? parsed : [];
                        } catch(e) {}

                        for (const entry of emails) {
                            if (typeof entry === 'object' && entry !== null) {
                                if (String(entry.email).toLowerCase().trim() === emailNormalized) {
                                    alreadyAccepted = true;
                                    userRole = entry.role || 'viewer';
                                    break;
                                }
                            } else if (typeof entry === 'string') {
                                if (entry.toLowerCase().trim() === emailNormalized) {
                                    alreadyAccepted = true;
                                    userRole = 'editor'; // Default legacy to editor
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        const { data: files } = await supabase.from('files')
            .select('id, original_name, file_size, mime_type, uploaded_at, file_path')
            .eq('folder_id', folder.id)
            .eq('is_deleted', 0)
            .order('uploaded_at', { ascending: false });

        res.json({
            folder: { id: folder.id, name: folder.name, created_at: folder.created_at },
            alreadyAccepted,
            userRole,
            files: (files || []).map(f => ({
                id: f.id,
                name: f.original_name,
                size: Number(f.file_size) || 0,
                type: f.mime_type,
                uploaded_at: f.uploaded_at,
                downloadUrl: `/api/files/public/download/${f.id}`
            }))
        });
    } catch (err) {
        console.error('[public-folder] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch(e) {}

// ── Email Sender Helper (Nodemailer Gmail + Resend Fallback) ──────
async function sendInviteEmail(toEmail, folderName, shareUrl, senderEmail) {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const resendApiKey = process.env.RESEND_API_KEY;

    const htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 16px; border: 1px solid #1e293b;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #6366f1; margin: 0; font-size: 24px;">☁️ Pocket Drive</h2>
                <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Secure Cloud Storage</p>
            </div>
            
            <div style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
                <h3 style="margin-top: 0; color: #f8fafc; font-size: 18px;">📁 Shared Folder Access Invitation</h3>
                <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
                    <strong>${senderEmail || 'Someone'}</strong> has shared the folder <span style="color: #f59e0b; font-weight: 600;">"${folderName}"</span> with you on Pocket Drive.
                </p>
                <p style="color: #94a3b8; font-size: 14px;">
                    You can view all items inside this folder, accept access to save it to your dashboard, and upload new files collaboratively.
                </p>
                <div style="text-align: center; margin: 28px 0 12px;">
                    <a href="${shareUrl}" target="_blank" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                        Open Shared Folder
                    </a>
                </div>
            </div>

            <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #64748b;">
                <p>Direct Link: <a href="${shareUrl}" style="color: #6366f1;">${shareUrl}</a></p>
                <p>&copy; ${new Date().getFullYear()} Pocket Drive. All rights reserved.</p>
            </div>
        </div>
    `;

    // 1. Try Nodemailer Gmail SMTP if configured
    if (nodemailer && gmailUser && gmailPass) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: gmailUser,
                    pass: gmailPass
                }
            });

            await transporter.sendMail({
                from: `"Pocket Drive" <${gmailUser}>`,
                to: toEmail,
                subject: `${senderEmail || 'A user'} shared a folder with you on Pocket Drive! 📁`,
                html: htmlContent
            });

            console.log('[Nodemailer] Gmail invite sent successfully to:', toEmail);
            return { success: true, service: 'gmail' };
        } catch (err) {
            console.error('[Nodemailer] Error sending via Gmail:', err.message);
        }
    }

    // 2. Fallback to Resend API if configured
    if (resendApiKey) {
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Pocket Drive <onboarding@resend.dev>',
                    to: [toEmail],
                    subject: `${senderEmail || 'A user'} shared a folder with you on Pocket Drive! 📁`,
                    html: htmlContent
                })
            });

            const resData = await response.json();
            console.log('[Resend] Email status:', response.status, resData);
            return { success: response.ok, resData, service: 'resend' };
        } catch (err) {
            console.error('[Resend] Error:', err.message);
            return { success: false, error: err.message };
        }
    }

    return { success: false, reason: 'No email credentials (GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY) in .env' };
}

// ── Share folder via Email ───────────────────────────────────
router.post('/share-email/:id', requireAuth, async (req, res) => {
    try {
        let { email, role } = req.body;
        if (!email || !email.trim()) return res.status(400).json({ error: 'Email address required' });
        email = email.trim().toLowerCase();
        
        role = role === 'editor' ? 'editor' : 'viewer'; // default to viewer

        // Get folder
        const { data: folder, error: fetchErr } = await supabase.from('folders')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId)
            .single();

        if (fetchErr || !folder) return res.status(404).json({ error: 'Folder not found' });

        // Get current user email
        const { data: currentUser } = await supabase.from('users')
            .select('email')
            .eq('id', req.session.userId)
            .single();

        const senderEmail = currentUser ? currentUser.email : 'A Pocket Drive User';

        if (currentUser && currentUser.email.toLowerCase() === email) {
            return res.status(400).json({ error: 'You cannot share a folder with yourself' });
        }

        // Ensure token exists
        let token = folder.share_token;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            await supabase.from('folders')
                .update({ is_shared: true, share_token: token })
                .eq('id', req.params.id);
        }

        // Try inserting/updating in folder_shares table
        try {
            // Delete first to avoid duplicates
            await supabaseAdmin.from('folder_shares')
                .delete()
                .eq('folder_id', folder.id)
                .eq('shared_with_email', email);

            await supabaseAdmin.from('folder_shares').insert([{
                folder_id: folder.id,
                shared_with_email: email,
                shared_by: req.session.userId,
                role: role
            }]);
        } catch (dbErr) {
            console.warn('[share-email] folder_shares table insert warning:', dbErr.message);
        }

        // Also update shared_emails array/JSON on folders table if column exists
        let updatedEmails = [];
        try {
            if (folder.shared_emails) {
                try {
                    const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                    updatedEmails = Array.isArray(parsed) ? parsed : [];
                } catch(e) { updatedEmails = []; }
            }
            // Filter out existing entries for this email (strings or objects)
            updatedEmails = updatedEmails.filter(entry => {
                if (typeof entry === 'object' && entry !== null) {
                    return String(entry.email).toLowerCase().trim() !== email;
                } else if (typeof entry === 'string') {
                    return entry.toLowerCase().trim() !== email;
                }
                return true;
            });
            
            // Push new entry with role
            updatedEmails.push({ email, role });

            await supabaseAdmin.from('folders')
                .update({ shared_emails: JSON.stringify(updatedEmails) })
                .eq('id', folder.id);
        } catch (e) {
            console.warn('[share-email] update shared_emails fallback warning:', e.message);
        }

        const shareUrl = `${req.protocol}://${req.get('host')}/shared-folder/${token}`;

        // Trigger automated email notification via Nodemailer (or Resend fallback)
        const emailResult = await sendInviteEmail(email, folder.name, shareUrl, senderEmail);

        let responseMsg = `Folder shared with ${email} as ${role}`;
        if (emailResult && emailResult.success) {
            responseMsg += ` & invitation email sent! ✉️`;
        } else if (emailResult && emailResult.reason) {
            responseMsg += ` (Access granted. Add GMAIL_USER & GMAIL_APP_PASSWORD in .env for inbox email sending).`;
        } else {
            responseMsg += ` & invitation recorded!`;
        }

        res.json({
            success: true,
            message: responseMsg,
            token,
            shareUrl,
            sharedWith: email,
            role
        });
    } catch (err) {
        console.error('[share-email] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Get list of shared emails for a folder ────────────────────
router.get('/shared-emails/:id', requireAuth, async (req, res) => {
    try {
        const { data: folder, error } = await supabaseAdmin.from('folders')
            .select('id, shared_emails')
            .eq('id', req.params.id)
            .eq('user_id', req.session.userId)
            .single();

        if (error || !folder) return res.status(404).json({ error: 'Folder not found' });

        let emailsList = [];
        // Try folder_shares table first
        try {
            const { data: shares } = await supabaseAdmin.from('folder_shares')
                .select('shared_with_email, role')
                .eq('folder_id', folder.id);

            if (shares && shares.length > 0) {
                emailsList = shares.map(s => ({
                    email: s.shared_with_email,
                    role: s.role || 'viewer'
                }));
            }
        } catch(e) {}

        // Fallback or merge from folders.shared_emails
        if (emailsList.length === 0 && folder.shared_emails) {
            try {
                const parsed = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(parsed)) {
                    emailsList = parsed.map(entry => {
                        if (typeof entry === 'object' && entry !== null) {
                            return { email: entry.email, role: entry.role || 'viewer' };
                        } else if (typeof entry === 'string') {
                            return { email: entry, role: 'viewer' };
                        }
                    });
                }
            } catch(e) {}
        }

        // De-duplicate list by email
        const unique = [];
        const seen = new Set();
        for (const entry of emailsList) {
            if (entry && entry.email && !seen.has(entry.email.toLowerCase())) {
                seen.add(entry.email.toLowerCase());
                unique.push(entry);
            }
        }

        res.json({ emails: unique });
    } catch (err) {
        console.error('[shared-emails] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Revoke email access to folder ────────────────────────────
router.delete('/share-email/:id', requireAuth, async (req, res) => {
    try {
        let { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        email = email.trim().toLowerCase();

        // Remove from folder_shares table
        try {
            await supabaseAdmin.from('folder_shares')
                .delete()
                .eq('folder_id', req.params.id)
                .eq('shared_with_email', email);
        } catch(e) {}

        // Remove from folder's shared_emails field
        const { data: folder } = await supabaseAdmin.from('folders')
            .select('id, shared_emails')
            .eq('id', req.params.id)
            .single();

        if (folder && folder.shared_emails) {
            try {
                let entries = typeof folder.shared_emails === 'string' ? JSON.parse(folder.shared_emails) : folder.shared_emails;
                if (Array.isArray(entries)) {
                    entries = entries.filter(entry => {
                        if (typeof entry === 'object' && entry !== null) {
                            return entry.email.toLowerCase() !== email;
                        } else if (typeof entry === 'string') {
                            return entry.toLowerCase() !== email;
                        }
                        return true;
                    });
                    await supabaseAdmin.from('folders')
                        .update({ shared_emails: JSON.stringify(entries) })
                        .eq('id', folder.id);
                }
            } catch(e) {}
        }

        res.json({ success: true, message: `Revoked access for ${email}` });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Get Folders Shared With Me ───────────────────────────────
router.get('/shared-with-me', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        let userEmail = (req.session.userEmail || '').toLowerCase().trim();

        if (!userEmail && typeof userId === 'string' && userId.includes('@')) {
            userEmail = userId.toLowerCase().trim();
        }

        if (!userEmail) {
            try {
                let { data: user } = await supabase.from('users')
                    .select('email')
                    .eq('id', userId)
                    .maybeSingle();

                if (!user && !isNaN(userId)) {
                    const numId = Number(userId);
                    const { data: userNum } = await supabase.from('users')
                        .select('email')
                        .eq('id', numId)
                        .maybeSingle();
                    user = userNum;
                }

                if (user && user.email) {
                    userEmail = user.email.toLowerCase().trim();
                }
            } catch(e) {}
        }


        let matchedFolderIds = new Set();

        // 1. folder_shares table — folders shared WITH this user by someone else
        if (userEmail) {
            try {
                // Use admin client so RLS doesn't filter out rows belonging to other users
                const { data: shares, error: sharesErr } = await supabaseAdmin
                    .from('folder_shares')
                    .select('folder_id, shared_by')
                    .ilike('shared_with_email', userEmail);

                if (sharesErr) console.error('[shared-with-me] shares query error:', sharesErr);

                if (shares && shares.length > 0) {
                    shares.forEach(s => {
                        // Only include if someone ELSE shared it (not the user themselves)
                        if (s.folder_id && String(s.shared_by) !== String(userId)) {
                            matchedFolderIds.add(String(s.folder_id));
                        }
                    });
                }
            } catch(e) { console.error('[shared-with-me] shares catch:', e); }
        }

        // 2. folders.shared_emails array — use admin client to bypass RLS and see all folders
        try {
            const { data: allFolders, error: allFoldersErr } = await supabaseAdmin
                .from('folders')
                .select('id, user_id, shared_emails');

            if (allFoldersErr) {
                console.error('[shared-with-me] allFolders query error:', allFoldersErr);
            }

            if (allFolders && allFolders.length > 0 && userEmail) {
                allFolders.forEach(f => {
                    if (!f.id) return;
                    const isOwner = String(f.user_id) === String(userId);
                    if (isOwner) return; // Skip own folders

                    if (f.shared_emails) {
                        let emails = [];
                        if (typeof f.shared_emails === 'string') {
                            try {
                                const parsed = JSON.parse(f.shared_emails);
                                emails = Array.isArray(parsed) ? parsed : [f.shared_emails];
                            } catch(e) {
                                emails = f.shared_emails.split(',').map(s => s.trim());
                            }
                        } else if (Array.isArray(f.shared_emails)) {
                            emails = f.shared_emails;
                        }

                        if (emails.some(e => String(e).toLowerCase().trim() === userEmail)) {
                            matchedFolderIds.add(String(f.id));
                        }
                    }
                });
            }
        } catch(e) { console.error('[shared-with-me] allFolders catch:', e); }

        const finalFolderIds = Array.from(matchedFolderIds);
        if (finalFolderIds.length === 0) return res.json([]);

        let folders = [];
        try {
            if (finalFolderIds.length > 0) {
                // Use admin client so RLS doesn't block fetching other users' folders
                const { data: matchedFolders, error: matchedErr } = await supabaseAdmin
                    .from('folders')
                    .select('*')
                    .in('id', finalFolderIds);
                if (matchedErr) console.error('[shared-with-me] matchedFolders error:', matchedErr);
                if (matchedFolders) {
                    folders = matchedFolders;
                }
            }
        } catch(e) { console.error('[shared-with-me] matchedFolders catch:', e); }


        if (!folders || folders.length === 0) return res.json([]);

        // Attach owner emails and file count
        const result = await Promise.all(folders.map(async f => {
            const isOwner = String(f.user_id) === String(userId);
            let ownerName = 'Folder Collaborator';
            let ownerEmail = 'Shared Folder';

            try {
                const { data: owner } = await supabase.from('users')
                    .select('name, email')
                    .eq('id', f.user_id)
                    .maybeSingle();

                if (owner) {
                    ownerName = owner.name || owner.email;
                    ownerEmail = owner.email;
                }
            } catch(e) {}

            let fileCount = 0;
            try {
                const { data: files } = await supabase.from('files')
                    .select('id')
                    .eq('folder_id', f.id)
                    .or('is_deleted.eq.0,is_deleted.is.null');

                fileCount = files ? files.length : 0;
            } catch(e) {}

            return {
                id: f.id,
                name: f.name,
                created_at: f.created_at,
                share_token: f.share_token,
                owner_name: isOwner ? 'You (Owner)' : ownerName,
                owner_email: isOwner ? (userEmail || 'Owner') : ownerEmail,
                file_count: fileCount,
                shareUrl: `/shared-folder/${f.share_token}`
            };
        }));

        res.json(result);
    } catch (err) {
        console.error('[shared-with-me] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Accept folder invitation by token ─────────────────────────
router.post('/accept/:token', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        let userEmail = req.session.userEmail ? req.session.userEmail.toLowerCase().trim() : '';

        if (!userEmail) {
            try {
                let { data: user } = await supabase.from('users')
                    .select('email')
                    .eq('id', userId)
                    .maybeSingle();

                if (!user && !isNaN(userId)) {
                    const numId = Number(userId);
                    const { data: userNum } = await supabase.from('users')
                        .select('email')
                        .eq('id', numId)
                        .maybeSingle();
                    user = userNum;
                }

                if (user && user.email) {
                    userEmail = user.email.toLowerCase().trim();
                }
            } catch(e) { console.error('[accept-share] get email error:', e); }
        }

        if (!userEmail) return res.status(400).json({ error: 'User email not found' });

        // Use admin client to fetch folder by token (may belong to another user — RLS would block anon)
        const { data: folder, error } = await supabaseAdmin
            .from('folders')
            .select('*')
            .eq('share_token', req.params.token)
            .maybeSingle();

        if (error) console.error('[accept-share] fetch folder error:', error);
        if (error || !folder) return res.status(404).json({ error: 'Shared folder not found or link expired' });

        // Add userEmail to folder_shares table
        try {
            const { error: insertErr } = await supabaseAdmin.from('folder_shares').insert([{
                folder_id: folder.id,
                shared_with_email: userEmail,
                shared_by: folder.user_id
            }]);
            if (insertErr) console.error('[accept-share] folder_shares insert error:', insertErr);
        } catch(e) { console.error('[accept-share] folder_shares catch:', e); }

        // Add to shared_emails array on folders table using admin client
        try {
            let emails = [];
            if (folder.shared_emails) {
                if (typeof folder.shared_emails === 'string') {
                    try {
                        const parsed = JSON.parse(folder.shared_emails);
                        emails = Array.isArray(parsed) ? parsed : [folder.shared_emails];
                    } catch(e) {
                        emails = folder.shared_emails.split(',').map(s => s.trim());
                    }
                } else if (Array.isArray(folder.shared_emails)) {
                    emails = folder.shared_emails;
                }
            }
            if (!emails.some(e => String(e).toLowerCase().trim() === userEmail)) {
                emails.push(userEmail);
                const { error: updateErr } = await supabaseAdmin
                    .from('folders')
                    .update({ shared_emails: JSON.stringify(emails) })
                    .eq('id', folder.id);
                if (updateErr) console.error('[accept-share] shared_emails update error:', updateErr);
            }
        } catch(e) { console.error('[accept-share] shared_emails catch:', e); }

        res.json({
            success: true,
            message: `You accepted invitation for folder "${folder.name}"`,
            folder: { id: folder.id, name: folder.name }
        });
    } catch (err) {
        console.error('[accept-share] error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── DEBUG: Shared-with-me diagnosis (remove after fixing) ─────
router.get('/debug-shared', async (req, res) => {
    try {
        // Get userId from session OR JWT cookie
        const sessionUserId = req.session && req.session.userId;
        const jwtUserId = verifyToken(req);
        const userId = sessionUserId || jwtUserId;
        const sessionEmail = (req.session && req.session.userEmail) || null;
        const adminConfigured = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
        const cookieHeader = req.headers.cookie || '(none)';

        // Get user email from DB
        let dbEmail = null;
        let dbUserErr = null;
        if (userId) {
            try {
                const { data: u, error: uErr } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
                dbEmail = u ? u.email : null;
                dbUserErr = uErr;
            } catch(e) { dbUserErr = e.message; }
        }

        const userEmail = (sessionEmail || dbEmail || '').toLowerCase().trim();

        // Check ALL folder_shares rows (not filtered) to see if table has data
        let allFolderSharesCount = 0;
        let folderSharesRows = [];
        let folderSharesErr = null;
        try {
            const { data, error, count } = await supabaseAdmin.from('folder_shares')
                .select('*', { count: 'exact' });
            allFolderSharesCount = count || (data ? data.length : 0);
            folderSharesErr = error;
            // If there's data, filter for this user
            if (data && userEmail) {
                folderSharesRows = data.filter(r =>
                    r.shared_with_email && r.shared_with_email.toLowerCase().trim() === userEmail
                );
            } else {
                folderSharesRows = data || [];
            }
        } catch(e) { folderSharesErr = e.message; }

        // Check all folders with shared_emails
        let matchedFolders = [];
        let allFoldersErr = null;
        let allFoldersCount = 0;
        try {
            const { data: allF, error } = await supabaseAdmin.from('folders').select('id, name, user_id, shared_emails');
            allFoldersErr = error;
            allFoldersCount = allF ? allF.length : 0;
            if (allF && userEmail) {
                allF.forEach(f => {
                    if (!f.shared_emails) return;
                    let emails = [];
                    try {
                        const parsed = typeof f.shared_emails === 'string' ? JSON.parse(f.shared_emails) : f.shared_emails;
                        emails = Array.isArray(parsed) ? parsed : [f.shared_emails];
                    } catch(e) {}
                    if (emails.some(e => String(e).toLowerCase().trim() === userEmail)) {
                        matchedFolders.push({ id: f.id, name: f.name, shared_emails: emails });
                    }
                });
            }
        } catch(e) { allFoldersErr = e.message; }

        res.json({
            auth: { sessionUserId, jwtUserId, userId, sessionEmail, dbEmail, userEmail, dbUserErr },
            config: { adminConfigured },
            cookies: cookieHeader.substring(0, 200),
            folderShares: { allFolderSharesCount, matchedForUser: folderSharesRows, error: folderSharesErr },
            folders: { allFoldersCount, matchedViaSharedEmails: matchedFolders, error: allFoldersErr }
        });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

