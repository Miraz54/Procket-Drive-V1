
// ============================================================
//  PROFESSIONAL TOAST SYSTEM
// ============================================================
const TOAST_ICONS = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    info:    'fa-circle-info',
    warning: 'fa-triangle-exclamation'
};

const TOAST_TITLES = {
    success: 'Success',
    error:   'Error',
    info:    'Info',
    warning: 'Warning'
};

function pdToast(type, title, msg, duration) {
    if (duration === undefined) duration = 4000;
    const container = document.getElementById('toast-container');
    if (!container) return;

    const t = document.createElement('div');
    t.className = 'pd-toast pd-' + type;
    t.innerHTML =
        '<div class="pd-toast-icon"><i class="fas ' + TOAST_ICONS[type] + '"></i></div>' +
        '<div class="pd-toast-body">' +
            '<div class="pd-toast-title">' + title + '</div>' +
            '<div class="pd-toast-msg">' + msg + '</div>' +
        '</div>' +
        '<button class="pd-toast-close" onclick="this.closest(\'.pd-toast\').remove()">&#x2715;</button>' +
        '<div class="pd-toast-progress">' +
            '<div class="pd-toast-progress-bar" style="animation-duration:' + duration + 'ms"></div>' +
        '</div>';

    container.appendChild(t);

    setTimeout(function() {
        t.classList.add('toast-exit');
        setTimeout(function() { if (t.parentNode) t.remove(); }, 380);
    }, duration);
}
/* ============================================================
   POCKET DRIVE  —  script.js
   ============================================================ */

let currentView = 'grid';
let activeNav   = 'drive'; // tracks active sidebar view (drive, recent)
let allFiles    = [];      // cached file list for search filtering
let allFolders  = [];      // cached folder list for current level
let currentFolderId = null;          // null = root
let sharedFolderId  = null;          // folder ID when viewing a shared folder
let folderStack = [];                // breadcrumb trail [{id, name}]

// ============================================================
//  THEME
// ============================================================
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('pd-theme', isLight ? 'light' : 'dark');
    updateToggleUI(isLight);
}

function updateToggleUI(isLight) {
    const icon  = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (icon) icon.textContent  = isLight ? '☀️' : '🌙';
    if (label) label.textContent = isLight ? 'Light' : 'Dark';

    const topbarIcon = document.getElementById('topbarThemeIcon');
    if (topbarIcon) {
        if (isLight) {
            topbarIcon.className = 'fas fa-sun';
            topbarIcon.style.color = '#f59e0b';
        } else {
            topbarIcon.className = 'fas fa-moon';
            topbarIcon.style.color = '';
        }
    }
}

(function initTheme() {
    const saved      = localStorage.getItem('pd-theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isLight    = saved === 'light' || (!saved && !prefersDark);
    if (isLight) document.body.classList.add('light-mode');
    document.addEventListener('DOMContentLoaded', () => updateToggleUI(isLight));
})();

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, type = 'info', duration = 2800) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast ${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, duration);
}

// ============================================================
//  AUTH TABS
// ============================================================
function showAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const tabLogin   = document.getElementById('tabLogin');
    const tabSignup  = document.getElementById('tabSignup');
    const heading    = document.getElementById('authHeading');

    if (tab === 'login') {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        tabLogin.classList.add('active');
        tabSignup.classList.remove('active');
        if (heading) heading.innerHTML = `
            <h1 class="auth-title">Welcome back 👋</h1>
            <p class="auth-subtitle">Sign in to access your personal cloud storage</p>`;
    } else {
        loginForm.classList.remove('active');
        signupForm.classList.add('active');
        tabLogin.classList.remove('active');
        tabSignup.classList.add('active');
        if (heading) heading.innerHTML = `
            <h1 class="auth-title">Create account 🚀</h1>
            <p class="auth-subtitle">Join Pocket Drive — your personal cloud storage</p>`;
    }
    const m = document.getElementById('authMessage');
    if (m) m.innerHTML = '';
}

// Password visibility toggle
window.togglePassword = function(fieldId, icon) {
    const f = document.getElementById(fieldId);
    if (!f) return;
    if (f.type === 'password') { f.type = 'text';     icon.classList.replace('fa-eye-slash', 'fa-eye'); }
    else                       { f.type = 'password'; icon.classList.replace('fa-eye', 'fa-eye-slash'); }
};

// Password match indicator
document.addEventListener('DOMContentLoaded', () => {
    const pwd     = document.getElementById('signupPassword');
    const confirm = document.getElementById('signupConfirmPassword');
    const msg     = document.getElementById('passwordMatchMsg');
    if (pwd && confirm && msg) {
        const validate = () => {
            if (!confirm.value.length) { msg.innerHTML = ''; return; }
            if (pwd.value === confirm.value) {
                msg.innerHTML = '✓ Passwords match'; msg.style.color = '#86efac';
            } else {
                msg.innerHTML = '✗ Passwords do not match'; msg.style.color = '#fca5a5';
            }
        };
        pwd.addEventListener('input', validate);
        confirm.addEventListener('input', validate);
    }
});

function hideInitSpinner() {
    const spinner = document.getElementById('appInitSpinner');
    if (spinner) {
        spinner.style.opacity = '0';
        spinner.style.visibility = 'hidden';
        setTimeout(() => { try { spinner.remove(); } catch(e) {} }, 300);
    }
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
            const user = await res.json();
            const emailEl = document.getElementById('userEmail');
            if (emailEl) emailEl.textContent = user.email;

            // Handle post-login redirection if any
            const redirectUrl = sessionStorage.getItem('pd_post_login_redirect');
            if (redirectUrl) {
                sessionStorage.removeItem('pd_post_login_redirect');
                window.location.href = redirectUrl;
                return;
            }

            showDashboard();
            if (window.location.search.includes('view=shared') || window.location.hash === '#shared' || window.location.pathname === '/shared' || window.location.pathname === '/shared-with-me') {
                switchView('shared');
            } else {
                await loadFiles();          // load files first (fills allFiles)
            }
            loadStorageStats();         // then stats (has fallback from allFiles)
            loadUserProfile();
            startStoragePolling();      // poll every 30 s
        } else {
            // Auto-login fallback if Remember Me was selected
            const remember = localStorage.getItem('pd-remember') === 'true';
            const email = localStorage.getItem('pd-email');
            const password = localStorage.getItem('pd-password');
            if (remember && email && password) {
                await autoLogin(email, password);
            }
        }
    } catch(e) { console.error('Auth check failed', e); }
    finally {
        hideInitSpinner();
    }
}

async function autoLogin(email, password) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        if (res.ok) {
            const emailEl = document.getElementById('userEmail');
            if (emailEl) emailEl.textContent = email;

            const redirectUrl = sessionStorage.getItem('pd_post_login_redirect');
            if (redirectUrl) {
                sessionStorage.removeItem('pd_post_login_redirect');
                window.location.href = redirectUrl;
                return;
            }

            showDashboard();
            if (window.location.search.includes('view=shared') || window.location.hash === '#shared') {
                switchView('shared');
            } else {
                await loadFiles();
            }
            loadStorageStats();
            loadUserProfile();
            startStoragePolling();
        }
    } catch(e) { console.error('[auth] Auto-login failed', e); }
}

async function login(e) {
    e.preventDefault();
    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res  = await fetch('/api/auth/login', {
            method:'POST', headers:{'Content-Type':'application/json'},
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            const emailEl = document.getElementById('userEmail');
            if (emailEl) emailEl.textContent = email;

            // Save credentials if Remember Me is checked
            const rememberMe = document.getElementById('rememberMe')?.checked;
            if (rememberMe) {
                localStorage.setItem('pd-remember', 'true');
                localStorage.setItem('pd-email', email);
                localStorage.setItem('pd-password', password);
            } else {
                localStorage.removeItem('pd-remember');
                localStorage.removeItem('pd-email');
                localStorage.removeItem('pd-password');
            }

            const redirectUrl = sessionStorage.getItem('pd_post_login_redirect');
            if (redirectUrl) {
                sessionStorage.removeItem('pd_post_login_redirect');
                window.location.href = redirectUrl;
                return;
            }

            showDashboard();
            await loadFiles();          // files first
            loadStorageStats();         // then stats
            loadUserProfile();
            startStoragePolling();      // start 30-s polling
            pdToast('success','Welcome back! 👤', 'You have been signed in successfully.', 4000);
        } else {
            showMessage('authMessage', data.error, 'error');
        }
    } catch(err) { showMessage('authMessage', 'Network error — is server running?', 'error'); }
}

async function signup(e) {
    e.preventDefault();
    const email    = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirm  = document.getElementById('signupConfirmPassword').value;
    if (password !== confirm) { showMessage('authMessage', 'Passwords do not match', 'error'); return; }
    if (password.length < 6)  { showMessage('authMessage', 'Password must be at least 6 characters', 'error'); return; }
    try {
        const res  = await fetch('/api/auth/register', {
            method:'POST', headers:{'Content-Type':'application/json'},
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            showMessage('authMessage', 'Account created! Please sign in.', 'success');
            pdToast('success', 'Account Created! ??', 'Your Pocket Drive account is ready. Please sign in.', 5000);
            showAuthTab('login');
            ['signupEmail','signupPassword','signupConfirmPassword'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
        } else { showMessage('authMessage', data.error, 'error'); }
    } catch(err) { showMessage('authMessage', 'Network error', 'error'); }
}

async function logout() {
    localStorage.removeItem('pd-remember');
    localStorage.removeItem('pd-email');
    localStorage.removeItem('pd-password');
    stopStoragePolling();
    await fetch('/api/auth/logout', { method:'POST', credentials: 'include' });
    const ap = document.getElementById('authPage');
    const pp = document.getElementById('appPage');
    if (ap) ap.style.display = '';
    if (pp) pp.style.display = 'none';
    allFiles = [];
    const em = document.getElementById('loginEmail');
    const ep = document.getElementById('loginPassword');
    if (em) em.value = '';
    if (ep) ep.value = '';
}

function showDashboard() {
    const ap = document.getElementById('authPage');
    const pp = document.getElementById('appPage');
    if (ap) ap.style.display = 'none';
    if (pp) pp.style.display = 'flex';
}

// ============================================================
//  SIDEBAR TOGGLE (mobile + desktop)
// ============================================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const main    = document.querySelector('.app-main');
    const isMobile = window.innerWidth <= 900;

    if (isMobile) {
        const isOpen = sidebar.classList.toggle('open');
        // Show/hide overlay
        let overlay = document.getElementById('sidebarOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebarOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:199;display:none;';
            overlay.onclick = () => toggleSidebar();
            document.body.appendChild(overlay);
        }
        overlay.style.display = isOpen ? 'block' : 'none';
    } else {
        sidebar.classList.toggle('hidden');
        if (main) main.classList.toggle('sidebar-hidden');
    }
}

function switchView(view) {
    activeNav = view; // update state
    const titleEl = document.getElementById('contentTitle');
    const dropzone = document.getElementById('uploadDropzone');
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));

    // Remove inAppFolderUpload if it exists
    const oldUpload = document.getElementById('inAppFolderUpload');
    if (oldUpload) oldUpload.remove();

    // Reset shared folder context on view switch
    sharedFolderId = null;

    // Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth <= 900 && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    if (view === 'drive') {
        document.getElementById('navMyDrive')?.classList.add('active');
        if (titleEl) titleEl.textContent = currentFolderId ? (folderStack[folderStack.length - 1]?.name || 'My Drive') : 'My Drive';
        const breadcrumbBar = document.getElementById('breadcrumbBar');
        if (breadcrumbBar) breadcrumbBar.style.display = folderStack.length > 0 ? 'flex' : 'none';
        if (dropzone) dropzone.style.display = '';
        loadFiles();
        if (window.location.pathname !== '/') {
            window.history.pushState(null, '', '/');
        }
    } else if (view === 'shared') {
        document.getElementById('navSharedWithMe')?.classList.add('active');
        if (titleEl) titleEl.textContent = 'Shared with me';
        const breadcrumbBar = document.getElementById('breadcrumbBar');
        if (breadcrumbBar) breadcrumbBar.style.display = 'none';
        if (dropzone) dropzone.style.display = 'none';
        showSharedWithMeView();
        if (window.location.pathname !== '/shared-with-me') {
            window.history.pushState(null, '', '/shared-with-me');
        }
    }
}

// ============================================================
//  STORAGE STATS  — real-time polling
// ============================================================
let _storageTimer = null;

async function loadStorageStats() {
    try {
        const res = await fetch('/api/files/storage-stats', { credentials: 'include' });
        if (!res.ok) {
            // Fallback: calculate from cached file list
            console.warn('[storage] API returned', res.status, '— using local fallback');
            updateStorageUI(allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0), allFiles.length);
            return;
        }
        const json = await res.json();
        if (json.error) {
            console.warn('[storage] API error:', json.error);
            updateStorageUI(allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0), allFiles.length);
            return;
        }
        updateStorageUI(json.used, json.count, json.total);
    } catch(e) {
        console.error('[storage] fetch failed:', e);
        // Fallback to local file list
        updateStorageUI(allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0), allFiles.length);
    }
}

function updateStorageUI(usedBytes, count, totalBytes) {
    totalBytes = totalBytes || (15 * 1024 * 1024 * 1024);
    usedBytes  = Number(usedBytes) || 0;
    count      = Number(count)     || 0;
    const pct  = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    const fillEl  = document.getElementById('storageBarFill');
    const pctEl   = document.getElementById('storagePercent');
    const usedEl  = document.getElementById('storageUsed');
    const totalEl = document.getElementById('storageTotal');
    const countEl = document.getElementById('storageFileCount');

    if (fillEl) {
        const w = Math.min(Math.max(pct, pct > 0 ? 1 : 0), 100);
        fillEl.style.width = w.toFixed(2) + '%';
        fillEl.classList.remove('warn', 'danger');
        if (pct >= 85)      fillEl.classList.add('danger');
        else if (pct >= 60) fillEl.classList.add('warn');
    }
    if (pctEl)   pctEl.textContent   = pct < 0.1 && pct > 0 ? '<0.1%' : pct.toFixed(1) + '%';
    if (usedEl)  usedEl.textContent  = formatFileSize(usedBytes);
    if (totalEl) totalEl.textContent = formatFileSize(totalBytes);
    if (countEl) countEl.textContent = count + (count === 1 ? ' file' : ' files');
}

function startStoragePolling() {
    if (_storageTimer) clearInterval(_storageTimer);
    _storageTimer = setInterval(loadStorageStats, 30000); // every 30 s
}

function stopStoragePolling() {
    if (_storageTimer) { clearInterval(_storageTimer); _storageTimer = null; }
}

// ============================================================
//  FILE UPLOAD
// ============================================================
async function uploadFile(input) {
    const file = input.files[0];
    if (!file) return;

    // 50 MB Limit check
    const maxSizeBytes = 50 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        showToast(`⚠️ File too large! Max limit is 50MB (Selected file: ${formatFileSize(file.size)})`, 'error', 5000);
        input.value = '';
        return;
    }


    const formData = new FormData();
    formData.append('file', file);
    // Use shared folder context if viewing a shared folder, otherwise use current folder
    const targetFolderId = sharedFolderId || currentFolderId;
    if (targetFolderId) formData.append('folder_id', targetFolderId);

    const xhr              = new XMLHttpRequest();
    const progressWrap     = document.getElementById('uploadProgressContainer');
    const progressBar      = document.getElementById('uploadProgressBar');
    const progressPct      = document.getElementById('uploadProgressPercent');
    const progressFilename = document.getElementById('progressFilename');

    if (progressWrap)     progressWrap.style.display = 'block';
    if (progressBar)      progressBar.style.width    = '0%';
    if (progressPct)      progressPct.textContent    = '0%';
    if (progressFilename) progressFilename.textContent = file.name;

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            if (progressBar) progressBar.style.width = pct + '%';
            if (progressPct) progressPct.textContent  = pct + '%';
        }
    });

    xhr.onload = () => {
        if (progressWrap) progressWrap.style.display = 'none';
        let response = null;
        try {
            response = JSON.parse(xhr.responseText);
        } catch (e) {}

        if (xhr.status === 200 && response && response.success) {
            showToast(`✅ ${file.name} uploaded!`, 'success');
            
            // Check if currently inside a shared folder view
            const sharedMatch = window.location.pathname.match(/^\/shared-folder\/([^\/]+)/);
            if (sharedMatch) {
                const token = sharedMatch[1];
                fetch('/api/auth/me', { credentials: 'include' })
                    .then(res => res.json())
                    .then(userData => {
                        showSharedFolderLoggedIn(token, userData);
                    });
            } else {
                // Optimistic storage update immediately
                const localUsed = allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0) + file.size;
                updateStorageUI(localUsed, allFiles.length + 1);
                loadFiles(); // refresh (also calls loadStorageStats)
            }
        } else {
            const errorMsg = (response && response.error) || `Upload failed (${xhr.status || 'Server error'})`;
            showToast(errorMsg, 'error', 6000);
        }
    };
    xhr.onerror = () => {
        if (progressWrap) progressWrap.style.display = 'none';
        showToast('Upload failed. Network error.', 'error');
    };

    xhr.open('POST', '/api/files/upload', true);
    xhr.send(formData);
    input.value = '';
}

// Drag and drop
function handleDrop(event) {
    event.preventDefault();
    const dropzone = document.getElementById('uploadDropzone');
    if (dropzone) dropzone.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    // Reuse the uploadFile logic via a fake input
    const dt = new DataTransfer();
    dt.items.add(file);
    const fakeInput = document.createElement('input');
    fakeInput.type = 'file';
    fakeInput.files = dt.files;
    uploadFile(fakeInput);
}

// ============================================================
//  LOAD & DISPLAY FILES
// ============================================================
async function loadFiles() {
    // Clear old data immediately to prevent showing stale files/folders from previous level
    allFiles = [];
    allFolders = [];
    renderDriveView();

    try {
        const fileUrl = currentFolderId
            ? `/api/files/list?folder_id=${currentFolderId}&t=${Date.now()}`
            : `/api/files/list?t=${Date.now()}`;
        const folderUrl = currentFolderId
            ? `/api/folders/list?parent_id=${currentFolderId}&t=${Date.now()}`
            : `/api/folders/list?t=${Date.now()}`;

        const [filesRes, foldersRes] = await Promise.all([
            fetch(fileUrl, { credentials: 'include' }).catch((e) => { console.error('[loadFiles] fetch files error:', e); return null; }),
            fetch(folderUrl, { credentials: 'include' }).catch((e) => { console.error('[loadFiles] fetch folders error:', e); return null; })
        ]);

        // If either request returns 401 (unauthorized), redirect/logout to clear the UI
        if ((filesRes && filesRes.status === 401) || (foldersRes && foldersRes.status === 401)) {
            console.warn('[auth] Session unauthorized (401), logging out. status: files=', filesRes ? filesRes.status : 'null', 'folders=', foldersRes ? foldersRes.status : 'null');
            logout();
            return;
        }

        if (filesRes && filesRes.ok) {
            const data = await filesRes.json().catch(() => null);
            if (Array.isArray(data)) allFiles = data;
        }
        if (foldersRes && foldersRes.ok) {
            const data = await foldersRes.json().catch(() => null);
            if (Array.isArray(data)) allFolders = data;
        }

        renderDriveView();
        const localUsed = allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0);
        updateStorageUI(localUsed, allFiles.length);
        loadStorageStats();
    } catch(e) { console.error(e); }
}

async function refreshCurrentView() {
    const syncIcon = document.querySelector('.view-controls .fa-sync-alt');
    if (syncIcon) syncIcon.classList.add('fa-spin');
    try {
        await loadFiles();
        showToast('🔄 View refreshed!', 'success');
    } catch(e) {
        showToast('Refresh failed', 'error');
    } finally {
        if (syncIcon) {
            setTimeout(() => {
                syncIcon.classList.remove('fa-spin');
            }, 600);
        }
    }
}


function filterFiles(query) {
    if (!query.trim()) { renderDriveView(); return; }
    const q = query.toLowerCase();
    const filteredFiles    = allFiles.filter(f => f.name.toLowerCase().includes(q));
    const filteredFolders  = allFolders.filter(f => f.name.toLowerCase().includes(q));
    renderDriveView(filteredFolders, filteredFiles);
}

function formatDateTime(iso) {
    if (!iso) return 'Unknown';
    return new Date(iso).toLocaleString();
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}

function truncateName(name, max) {
    return name.length > max ? name.substring(0, max - 3) + '…' : name;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getFileIcon(mimeType, fileId, fileName) {
    if (!mimeType) mimeType = '';
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (mimeType.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
        return `<img src="/api/files/preview/${fileId}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-file-image\\' style=\\'font-size:32px;color:#10b981\\'></i>'">`;
    }
    if (mimeType.includes('pdf') || ext === 'pdf') {
        return `<i class="fas fa-file-pdf" style="font-size:32px;color:#ef4444;"></i>`;
    }
    if (mimeType.includes('video') || ['mp4','webm','ogg','avi','mov','mkv'].includes(ext)) {
        return `<i class="fas fa-file-video" style="font-size:32px;color:#8b5cf6;"></i>`;
    }
    if (mimeType.includes('audio') || ['mp3','wav','ogg','aac','flac'].includes(ext)) {
        return `<i class="fas fa-file-audio" style="font-size:32px;color:#f59e0b;"></i>`;
    }
    if (mimeType.includes('word') || ['doc','docx'].includes(ext)) {
        return `<i class="fas fa-file-word" style="font-size:32px;color:#3b82f6;"></i>`;
    }
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || ['xls','xlsx','csv'].includes(ext)) {
        return `<i class="fas fa-file-excel" style="font-size:32px;color:#10b981;"></i>`;
    }
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || ['ppt','pptx'].includes(ext)) {
        return `<i class="fas fa-file-powerpoint" style="font-size:32px;color:#ef4444;"></i>`;
    }
    if (mimeType.startsWith('text/') || ['txt','md','json','js','css','html','xml'].includes(ext)) {
        return `<i class="fas fa-file-alt" style="font-size:32px;color:#6b7280;"></i>`;
    }
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z') || ['zip','rar','7z','tar','gz'].includes(ext)) {
        return `<i class="fas fa-file-archive" style="font-size:32px;color:#f59e0b;"></i>`;
    }
    return `<i class="fas fa-file" style="font-size:32px;color:#6b7280;"></i>`;
}


// ============================================================
//  FOLDER SYSTEM
// ============================================================

// ── Open a folder (navigate into it) ────────────────────────
async function openFolder(id) {
    let folder = allFolders.find(f => String(f.id) === String(id));
    let name = folder ? folder.name : 'Shared Folder';

    if (!folder) {
        try {
            const res = await fetch(`/api/folders/share/${id}`, { credentials: 'include' });
            const data = await res.json();
            if (data && data.folderName) name = data.folderName;
        } catch(e) {}
    }

    currentFolderId = id;
    folderStack.push({ id, name });
    const titleEl = document.getElementById('contentTitle');
    if (titleEl) titleEl.textContent = name;
    loadFiles();
}

// ── Go back to root ──────────────────────────────────────────
function goToRoot() {
    sharedFolderId = null;
    currentFolderId = null;
    folderStack = [];
    const titleEl = document.getElementById('contentTitle');
    if (titleEl) titleEl.textContent = 'My Drive';
    loadFiles();
}

// ── Navigate to specific breadcrumb depth ────────────────────
function goToStackIndex(i) {
    folderStack = folderStack.slice(0, i + 1);
    const f = folderStack[folderStack.length - 1];
    currentFolderId = f ? f.id : null;
    const name = f ? f.name : 'My Drive';
    const titleEl = document.getElementById('contentTitle');
    if (titleEl) titleEl.textContent = name;
    loadFiles();
}

function updateDropzoneLabel() {
    const textEl = document.querySelector('.dropzone-text');
    const subEl  = document.querySelector('.dropzone-sub');
    if (currentFolderId && folderStack.length > 0) {
        const folderName = folderStack[folderStack.length - 1].name;
        if (textEl) textEl.innerHTML = `Upload into <span class="dropzone-link">${escapeHtml(folderName)}</span>`;
        if (subEl)  subEl.textContent = 'Files will be saved in this folder • Max 50MB per file';
    } else {
        if (textEl) textEl.innerHTML = 'Drop files here or <span class="dropzone-link">click to upload</span>';
        if (subEl)  subEl.textContent = 'Any supported file • Max 50MB per file';
    }
}

function renderDriveView(folders, files) {
    folders = folders !== undefined ? folders : allFolders;
    files   = files   !== undefined ? files   : allFiles;
    renderBreadcrumbs();
    updateDropzoneLabel();
    const container = document.getElementById('fileList');
    if (!container) return;

    if (folders.length === 0 && files.length === 0) {
        container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
            <p>${currentFolderId ? 'This folder is empty' : 'No files yet'}</p>
            <small>${currentFolderId ? 'Upload files or create sub-folders' : 'Upload your first file to get started!'}</small>
        </div>`;
        return;
    }

    let html = '';
    // Render folders first
    if (currentView === 'grid') {
        html += folders.map(f => {
            const isShared = f.is_shared === true || f.is_shared === 1 || (f.shared_emails && f.shared_emails.length > 0);
            const folderIconHtml = isShared
                ? `<div class="shared-folder-icon-wrapper grid-icon">
                       <i class="fas fa-folder" style="font-size:40px;color:#f59e0b;"></i>
                       <span class="shared-folder-icon-overlay"><i class="fas fa-users"></i></span>
                   </div>`
                : `<i class="fas fa-folder" style="font-size:40px;color:#f59e0b;"></i>`;

            return `
            <div class="file-card folder-card">
                <div class="file-icon">
                    ${folderIconHtml}
                </div>
                <div class="file-name" title="${escapeHtml(f.name)}">${truncateName(f.name, 22)}</div>
                <div class="file-size">Folder</div>
                <div class="file-actions">
                    <button title="Open Folder" onclick="openFolder('${f.id}')" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;border-color:transparent;"><i class="fas fa-folder-open"></i></button>
                    <button title="Share Folder" class="share-btn" onclick="shareFolderModal('${f.id}')"><i class="fas fa-share-alt"></i></button>
                    <button title="Rename" onclick="renameFolderPrompt('${f.id}')"><i class="fas fa-pencil-alt"></i></button>
                    <button title="Delete" class="delete-file-btn" onclick="deleteFolderConfirm('${f.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
        html += files.map(f => `
        <div class="file-card">
            <div class="file-icon">${getFileIcon(f.type, f.id, f.name)}</div>
            <div class="file-name" title="${escapeHtml(f.name)}">${truncateName(f.name, 22)}</div>
            <div class="file-size">${formatFileSize(f.size)}</div>
            <div class="file-date"><i class="fas fa-calendar-alt"></i> ${formatDateTime(f.uploaded_at)}</div>
            <div class="file-actions">
                <button title="Preview"  onclick="previewFile('${f.id}')"><i class="fas fa-eye"></i></button>
                <button title="Share"    class="share-btn" onclick="shareFile('${f.id}')"><i class="fas fa-share-alt"></i></button>
                <button title="Download" onclick="downloadFile('${f.id}')"><i class="fas fa-download"></i></button>
                <button title="Delete"   class="delete-file-btn" onclick="deleteFile('${f.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join('');
    } else {
        html += folders.map(f => {
            const isShared = f.is_shared === true || f.is_shared === 1 || (f.shared_emails && f.shared_emails.length > 0);
            const folderIconHtml = isShared
                ? `<div class="shared-folder-icon-wrapper list-icon">
                       <i class="fas fa-folder" style="font-size:28px;color:#f59e0b;"></i>
                       <span class="shared-folder-icon-overlay"><i class="fas fa-users"></i></span>
                   </div>`
                : `<i class="fas fa-folder" style="font-size:28px;color:#f59e0b;"></i>`;

            return `
            <div class="file-list-item folder-list-item">
                <div class="file-list-info" style="flex:1;">
                    <div class="file-list-icon">${folderIconHtml}</div>
                    <div class="file-list-details"><div class="file-list-name">${escapeHtml(f.name)}</div><div class="file-list-meta">Folder &bull; ${new Date(f.created_at).toLocaleDateString()}</div></div>
                </div>
                <div class="file-list-actions">
                    <button title="Open Folder" onclick="openFolder('${f.id}')" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;border-color:transparent;"><i class="fas fa-folder-open"></i></button>
                    <button title="Share Folder" class="share-btn" onclick="shareFolderModal('${f.id}')"><i class="fas fa-share-alt"></i></button>
                    <button title="Rename" onclick="renameFolderPrompt('${f.id}')"><i class="fas fa-pencil-alt"></i></button>
                    <button title="Delete" class="delete-file-btn" onclick="deleteFolderConfirm('${f.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
        html += files.map(f => `
        <div class="file-list-item"><div class="file-list-info"><div class="file-list-icon">${getFileIcon(f.type, f.id, f.name)}</div><div class="file-list-details"><div class="file-list-name">${escapeHtml(f.name)}</div><div class="file-list-meta">${formatFileSize(f.size)} &bull; <i class="fas fa-calendar-alt"></i> ${formatDateTime(f.uploaded_at)}</div></div></div><div class="file-list-actions"><button title="Preview" onclick="previewFile('${f.id}')"><i class="fas fa-eye"></i></button><button title="Share" class="share-btn" onclick="shareFile('${f.id}')"><i class="fas fa-share-alt"></i></button><button title="Download" onclick="downloadFile('${f.id}')"><i class="fas fa-download"></i></button><button title="Delete"   class="delete-file-btn" onclick="deleteFile('${f.id}')"><i class="fas fa-trash"></i></button></div></div>`).join('');
    }
    container.innerHTML = html;
}

function renderBreadcrumbs() {
    const bar = document.getElementById('breadcrumbBar');
    if (!bar) return;
    let html = `<span class="breadcrumb-item" onclick="goToRoot()"><i class="fas fa-home"></i> My Drive</span>`;
    folderStack.forEach((f, i) => {
        html += `<span class="breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>`;
        if (i < folderStack.length - 1) {
            html += `<span class="breadcrumb-item" onclick="goToStackIndex(${i})">${escapeHtml(f.name)}</span>`;
        } else {
            html += `<span class="breadcrumb-item active">${escapeHtml(f.name)}</span>`;
        }
    });
    bar.innerHTML = html;
    bar.style.display = folderStack.length > 0 ? 'flex' : 'none';
}



function openCreateFolderModal() {
    const input = document.getElementById('newFolderName');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }
    openModal('createFolderModal');
}

function closeCreateFolderModal() {
    const input = document.getElementById('newFolderName');
    if (input) input.value = '';
    closeModal('createFolderModal');
}

let isCreatingFolder = false;

async function createFolder() {
    if (isCreatingFolder) return;
    const input = document.getElementById('newFolderName');
    const name = input?.value?.trim();
    if (!name) { showToast('Enter a folder name', 'warning'); return; }

    const exists = allFolders.some(f => f.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        showToast(`⚠️ Folder "${name}" already exists!`, 'warning');
        return;
    }

    isCreatingFolder = true;
    try {
        const res = await fetch('/api/folders/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, parent_id: currentFolderId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`📁 "${name}" created!`, 'success');
            closeCreateFolderModal();
            loadFiles();
        } else {
            showToast(data.error || 'Failed to create folder', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    } finally {
        isCreatingFolder = false;
    }
}

let targetRenameFolderId = null;

function renameFolderPrompt(id) {
    const folder = allFolders.find(f => String(f.id) === String(id));
    if (!folder) return;
    targetRenameFolderId = id;
    const input = document.getElementById('renameFolderNameInput');
    if (input) {
        input.value = folder.name;
        setTimeout(() => { input.focus(); input.select(); }, 100);
    }
    openModal('renameFolderModal');
}

function closeRenameFolderModal() {
    targetRenameFolderId = null;
    closeModal('renameFolderModal');
}

async function submitRenameFolder() {
    if (!targetRenameFolderId) return;
    const input = document.getElementById('renameFolderNameInput');
    const name = input?.value?.trim();
    const folder = allFolders.find(f => String(f.id) === String(targetRenameFolderId));
    if (!name) { showToast('Folder name cannot be empty', 'warning'); return; }
    if (folder && name === folder.name) { closeRenameFolderModal(); return; }

    const exists = allFolders.some(f => String(f.id) !== String(targetRenameFolderId) && f.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        showToast(`⚠️ Folder "${name}" already exists!`, 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/folders/rename/${targetRenameFolderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('📁 Folder renamed successfully!', 'success');
            closeRenameFolderModal();
            loadFiles();
        } else {
            showToast(data.error || 'Rename failed', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

function deleteFolderConfirm(id) {
    const folder = allFolders.find(f => String(f.id) === String(id));
    const name = folder ? folder.name : 'Folder';
    showConfirmDialog(
        'Delete Folder',
        `Delete "${name}"? Files inside will be moved to My Drive root.`,
        true
    ).then(confirmed => {
        if (!confirmed) return;
        fetch(`/api/folders/delete/${id}`, { method: 'DELETE', credentials: 'include' })
            .then(res => {
                if (res.ok) { showToast('Folder deleted', 'success'); loadFiles(); }
                else showToast('Delete failed', 'error');
            })
            .catch(() => showToast('Network error', 'error'));
    });
}

async function removeSharedFolder(id, token) {
    showConfirmDialog(
        'Remove Folder',
        'Remove this folder from your Shared with me list?',
        true
    ).then(async confirmed => {
        if (!confirmed) return;
        try {
            // Get current logged-in user email
            const authRes = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
            if (authRes && authRes.ok) {
                const user = await authRes.json();
                if (user && user.email) {
                    // Call API to revoke email share from folder_shares table
                    await fetch(`/api/folders/share-email/${id}`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ email: user.email })
                    });
                }
            }

            // Remove from client local storage
            try {
                const currentUserEmail = (document.getElementById('userEmail')?.textContent || '').trim().toLowerCase();
                const localStorageKey = currentUserEmail ? `pd_accepted_folders_${currentUserEmail}` : 'pd_accepted_folders_anonymous';
                let saved = JSON.parse(localStorage.getItem(localStorageKey) || '[]');
                if (Array.isArray(saved)) {
                    saved = saved.filter(sf => String(sf.id) !== String(id) && sf.share_token !== token);
                    localStorage.setItem(localStorageKey, JSON.stringify(saved));
                }
            } catch(e) {}

            pdToast('success', 'Folder Removed', 'Folder has been removed from Shared with me.', 3000);
            showSharedWithMeView();
        } catch(err) {
            console.error('Failed to remove shared folder:', err);
            showToast('Failed to remove folder', 'error');
        }
    });
}


let currentShareFolderId = null;

async function shareFolderModal(id) {
    currentShareFolderId = id;
    const folder = allFolders.find(f => String(f.id) === String(id));
    const name = folder ? folder.name : 'Folder';
    try {
        const res = await fetch(`/api/folders/share/${id}`, {
            method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) { showToast('Could not get share link', 'error'); return; }

        document.getElementById('shareFileName').textContent = name;
        document.getElementById('shareFileMeta').textContent = 'Shared Folder';
        document.getElementById('shareFileIcon').innerHTML = '<i class="fas fa-folder" style="font-size:36px;color:#f59e0b;"></i>';
        const previewBox = document.getElementById('shareImagePreview');
        if (previewBox) { previewBox.innerHTML = ''; previewBox.style.display = 'none'; }
        document.getElementById('shareLinkInput').value = data.shareUrl || '';

        const openLink = document.getElementById('shareOpenLink');
        if (openLink) { openLink.href = data.shareUrl || ''; openLink.target = '_blank'; }

        const copyBtn = document.getElementById('shareCopyBtn');
        if (copyBtn) { copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; copyBtn.classList.remove('copied'); }

        const emailInput = document.getElementById('shareEmailInput');
        if (emailInput) emailInput.value = '';
        loadSharedEmails(id);

        openModal('shareModal');
    } catch (err) {
        showToast('Failed to get share link', 'error');
    }
}

async function loadSharedEmails(folderId) {
    const listEl = document.getElementById('sharedEmailList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="font-size:0.8rem;color:var(--text-3);"><i class="fas fa-spinner fa-spin"></i> Loading shared users...</div>';

    try {
        const res = await fetch(`/api/folders/shared-emails/${folderId}`, { credentials: 'include' });
        const data = await res.json();
        if (res.ok && data.emails && data.emails.length > 0) {
            listEl.innerHTML = data.emails.map(entry => {
                const email = typeof entry === 'string' ? entry : entry.email;
                const role = typeof entry === 'object' && entry ? (entry.role || 'viewer') : 'viewer';

                return `
                <div class="shared-email-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-hover);border-radius:8px;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;flex:1;">
                        <span class="shared-email-text" style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;"><i class="fas fa-user-check" style="color:#86efac;"></i> ${escapeHtml(email)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <select onchange="updateCollaboratorRole('${folderId}', '${escapeHtml(email)}', this.value)" style="background:var(--bg-input, rgba(255,255,255,0.05));color:var(--text-1);border:1px solid var(--border);padding:2px 6px;border-radius:6px;font-size:0.75rem;cursor:pointer;outline:none;">
                            <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
                            <option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option>
                        </select>
                        <button class="shared-email-revoke" onclick="revokeShareEmail('${escapeHtml(email)}')" title="Revoke access" style="background:none;border:none;color:var(--text-3);cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-times"></i></button>
                    </div>
                </div>`;
            }).join('');
        } else {
            listEl.innerHTML = '<div style="font-size:0.8rem;color:var(--text-3);">Not shared with any specific email yet.</div>';
        }
    } catch(e) {
        listEl.innerHTML = '';
    }
}

async function updateCollaboratorRole(folderId, email, newRole) {
    try {
        const res = await fetch(`/api/folders/share-email/${folderId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email: email, role: newRole })
        });
        if (res.ok) {
            pdToast('success', 'Updated!', `Updated ${email} permission to ${newRole}.`, 2000);
            loadSharedEmails(folderId);
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to update permission', 'error');
            loadSharedEmails(folderId);
        }
    } catch(err) {
        showToast('Network error', 'error');
        loadSharedEmails(folderId);
    }
}

async function submitShareEmail() {
    if (!currentShareFolderId) {
        showToast('Please select a folder to share', 'warning');
        return;
    }
    const input = document.getElementById('shareEmailInput');
    const roleInput = document.getElementById('shareRoleInput');
    const email = input?.value?.trim();
    const role = roleInput?.value || 'viewer';
    if (!email) {
        showToast('Please enter an email address', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/folders/share-email/${currentShareFolderId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, role })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`✉️ Folder shared as ${role}!`, 'success');
            if (input) input.value = '';
            loadSharedEmails(currentShareFolderId);
        } else {
            showToast(data.error || 'Failed to share folder', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function revokeShareEmail(email) {
    if (!currentShareFolderId) return;
    try {
        const res = await fetch(`/api/folders/share-email/${currentShareFolderId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Access revoked for ${email}`, 'info');
            loadSharedEmails(currentShareFolderId);
        } else {
            showToast(data.error || 'Failed to revoke access', 'error');
        }
    } catch(err) {
        showToast('Network error', 'error');
    }
}

async function showSharedWithMeView() {
    activeNav = 'shared';
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('navSharedWithMe')?.classList.add('active');

    const title = document.getElementById('contentTitle');
    if (title) title.textContent = 'Shared with me';

    const breadcrumbBar = document.getElementById('breadcrumbBar');
    if (breadcrumbBar) breadcrumbBar.style.display = 'none';

    // Hide upload drop zone — shared folders have their own upload inside
    const dropzone = document.getElementById('uploadDropzone');
    if (dropzone) dropzone.style.display = 'none';

    const container = document.getElementById('fileList');
    if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-2);grid-column:1/-1;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:12px;">Loading items shared with you...</p></div>';

    try {
        const res = await fetch('/api/folders/shared-with-me', { credentials: 'include' });
        let sharedFolders = await res.json();
        if (!Array.isArray(sharedFolders)) sharedFolders = [];

        // Merge client-side accepted folder persistence (scoped by user email to prevent leaks)
        try {
            const currentUserEmail = (document.getElementById('userEmail')?.textContent || '').trim().toLowerCase();
            const localStorageKey = currentUserEmail ? `pd_accepted_folders_${currentUserEmail}` : 'pd_accepted_folders_anonymous';
            let localAccepted = JSON.parse(localStorage.getItem(localStorageKey) || '[]');
            
            // Auto clean legacy unscoped key if exists
            localStorage.removeItem('pd_accepted_folders');

            if (Array.isArray(localAccepted)) {
                localAccepted.forEach(lf => {
                    if (lf && (lf.id || lf.share_token) && !sharedFolders.some(sf => String(sf.id) === String(lf.id) || (sf.share_token && sf.share_token === lf.share_token))) {
                        sharedFolders.push(lf);
                    }
                });
            }
        } catch(e) {}

        if (sharedFolders.length === 0) {
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;padding:60px 20px;color:var(--text-2);grid-column:1/-1;">
                        <i class="fas fa-user-friends" style="font-size:3.5rem;margin-bottom:16px;opacity:0.4;"></i>
                        <h3>Nothing shared with you yet</h3>
                        <p style="font-size:0.9rem;margin-top:6px;">Folders shared with your email will appear here.</p>
                    </div>
                `;
            }
            return;
        }

        if (container) {
            container.innerHTML = sharedFolders.map(sf => {
                const ownerInitial = (sf.owner_name || 'F').charAt(0).toUpperCase();
                const ownerDisplay = sf.owner_name || 'Shared Folder';
                const ownerEmailDisplay = sf.owner_email && sf.owner_email !== 'Shared Folder' ? sf.owner_email : '';
                const fileCount = sf.file_count || 0;
                const shareUrl = sf.shareUrl || '#';

                return `
                <div class="shared-folder-card" onclick="window.location.href='${shareUrl}'">
                    <div class="sfc-header">
                        <div class="sfc-folder-icon">
                            <div class="shared-folder-icon-wrapper card-icon">
                                <i class="fas fa-folder"></i>
                                <span class="shared-folder-icon-overlay"><i class="fas fa-users"></i></span>
                            </div>
                        </div>
                        <div class="sfc-badge">${fileCount} file${fileCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="sfc-body">
                        <div class="sfc-name" title="${escapeHtml(sf.name)}">${escapeHtml(sf.name)}</div>
                        <div class="sfc-owner">
                            <div class="sfc-avatar">${escapeHtml(ownerInitial)}</div>
                            <div class="sfc-owner-info">
                                <span class="sfc-owner-name">${escapeHtml(ownerDisplay)}</span>
                                ${ownerEmailDisplay ? `<span class="sfc-owner-email">${escapeHtml(ownerEmailDisplay)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="sfc-footer" style="flex-wrap: wrap; gap: 4px;">
                        <button class="sfc-btn sfc-btn-link" style="min-width: 60px; padding: 6px 8px;" onclick="event.stopPropagation(); if(navigator.clipboard){navigator.clipboard.writeText(window.location.origin + '${shareUrl}').then(()=>pdToast('success','Copied!','Share link copied.',2000))}">
                            <i class="fas fa-link"></i> Share
                        </button>
                        <button class="sfc-btn sfc-btn-danger" style="min-width: 65px; padding: 6px 8px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.25);" onclick="event.stopPropagation(); removeSharedFolder('${sf.id}', '${sf.share_token}')">
                            <i class="fas fa-trash-alt"></i> Remove
                        </button>
                        <button class="sfc-btn sfc-btn-open" style="min-width: 100px; padding: 6px 8px;" onclick="event.stopPropagation(); window.location.href='${shareUrl}'">
                            <i class="fas fa-folder-open"></i> Open
                        </button>
                    </div>
                </div>
                `;
            }).join('');
        }
    } catch(err) {
        console.error('Failed to fetch shared items', err);
        if (container) container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);grid-column:1/-1;">Failed to load shared items.</div>';
    }
}


function displayFiles(files) { renderDriveView(allFolders, files); }

// ============================================================
//  VIEW TOGGLE
// ============================================================
function setView(view) {
    currentView = view;
    const container = document.getElementById('fileList');
    const gridBtn   = document.getElementById('gridViewBtn');
    const listBtn   = document.getElementById('listViewBtn');
    if (view === 'grid') {
        container?.classList.replace('list-view', 'grid-view') || container?.classList.add('grid-view');
        gridBtn?.classList.add('active'); listBtn?.classList.remove('active');
    } else {
        container?.classList.replace('grid-view', 'list-view') || container?.classList.add('list-view');
        listBtn?.classList.add('active'); gridBtn?.classList.remove('active');
    }
    renderDriveView();
}


// ============================================================
//  SHARE FILE  (Google Drive-style — anyone with link can download)
// ============================================================
async function shareFile(id) {
    const file = allFiles.find(f => String(f.id) === String(id));
    const name = file ? file.name : 'File';
    const type = file ? file.type : '';
    const size = file ? file.size : 0;
    try {
        const res  = await fetch(`/api/files/share/${id}`);
        const data = await res.json();
        if (!res.ok) { showToast('Could not get share link', 'error'); return; }

        // The public preview link — opens interactive preview page
        const publicShareUrl = `${location.origin}/share/file/${id}`;
        // The public download URL (for direct download action)
        const publicDownloadUrl = `${location.origin}/api/files/public/download/${id}`;
        // Direct Supabase storage URL
        const publicViewUrl = data.url;

        // Populate modal
        document.getElementById('shareFileName').textContent = name;
        document.getElementById('shareFileMeta').textContent = formatFileSize(data.size || size) + ' • ' + (type || 'File');
        document.getElementById('shareFileIcon').innerHTML   = getFileIcon(type, id, name);

        // Image preview section — show thumbnail + link together
        const isImage = type && type.startsWith('image/');
        const previewBox = document.getElementById('shareImagePreview');
        if (previewBox) {
            if (isImage) {
                previewBox.innerHTML = `<img src="/api/files/public/preview/${id}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:200px;border-radius:10px;object-fit:contain;display:block;margin:0 auto;">`;
                previewBox.style.display = 'block';
            } else {
                previewBox.innerHTML = '';
                previewBox.style.display = 'none';
            }
        }

        // Share link = public preview URL
        document.getElementById('shareLinkInput').value = publicShareUrl;

        const openLink     = document.getElementById('shareOpenLink');
        const downloadLink = document.getElementById('shareDownloadLink');
        if (openLink)     { openLink.href = publicShareUrl; openLink.target = '_blank'; }
        if (downloadLink) { downloadLink.href = publicDownloadUrl; downloadLink.removeAttribute('target'); }

        // Reset copy button
        const copyBtn = document.getElementById('shareCopyBtn');
        if (copyBtn) { copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; copyBtn.classList.remove('copied'); }

        openModal('shareModal');
    } catch(err) {
        showToast('Failed to get share link', 'error');
        console.error(err);
    }
}

function copyShareLink() {
    const input   = document.getElementById('shareLinkInput');
    const copyBtn = document.getElementById('shareCopyBtn');
    if (!input) return;

    navigator.clipboard.writeText(input.value).then(() => {
        if (copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                copyBtn.classList.remove('copied');
            }, 2500);
        }
        showToast('🔗 Link copied to clipboard!', 'success');
    }).catch(() => {
        // Fallback for older browsers
        input.select();
        document.execCommand('copy');
        showToast('Link copied!', 'success');
    });
}

function closeShareModal() { closeModal('shareModal'); }

// ============================================================
//  PREVIEW & DOWNLOAD
// ============================================================
async function previewFile(id) {
    const file = allFiles.find(f => String(f.id) === String(id));
    const name = file ? file.name : 'File';
    const type = file ? file.type : '';

    const modal   = document.getElementById('previewModal');
    const title   = document.getElementById('previewFileName');
    const content = document.getElementById('previewContent');
    if (title)   title.innerHTML  = `<i class="fas fa-eye"></i> ${escapeHtml(name)}`;
    if (content) content.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-2)"><i class="fas fa-spinner fa-spin"></i> Loading preview…</div>';
    openModal('previewModal');

    const ext = name.split('.').pop().toLowerCase();
    const isOffice = ['doc','docx','xls','xlsx','ppt','pptx'].includes(ext) || 
                     type.includes('word') || type.includes('excel') || type.includes('spreadsheet') || type.includes('powerpoint') || type.includes('presentation');
    const isVideo = type.startsWith('video/') || ['mp4','webm','ogg','avi','mov','mkv'].includes(ext);
    const isAudio = type.startsWith('audio/') || ['mp3','wav','ogg','aac','flac'].includes(ext);

    try {
        // For MS Office or Video/Audio files, fetch the public Supabase direct URL
        if (isOffice || isVideo || isAudio) {
            const res = await fetch(`/api/files/share/${id}`, { credentials: 'include' });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error('Could not get public file URL');

            if (isOffice) {
                // Microsoft Office Viewer embedding requires a public URL
                const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(data.url)}`;
                content.innerHTML = `<iframe src="${officeUrl}" style="width:100%;height:68vh;border:none;"></iframe>`;
            } else if (isVideo) {
                // Direct streaming video (supports seeking/range requests)
                content.innerHTML = `<video controls autoplay style="max-width:100%;max-height:68vh;background:#000;"><source src="${data.url}"></video>`;
            } else if (isAudio) {
                // Direct streaming audio
                content.innerHTML = `<audio controls autoplay style="width:100%;margin-top:24px;"><source src="${data.url}"></audio>`;
            }
        } else {
            // For standard files, fetch as a blob via authentication
            const res = await fetch(`/api/files/preview/${id}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Preview failed');
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            content.dataset.blobUrl = url;

            if (type.startsWith('image/')) {
                content.innerHTML = `<img src="${url}" alt="${escapeHtml(name)}">`;
            } else if (type === 'application/pdf' || ext === 'pdf') {
                content.innerHTML = `<iframe src="${url}" style="width:100%;height:68vh;border:none;"></iframe>`;
            } else if (type.startsWith('text/') || ['txt','md','json','js','css','html','xml'].includes(ext)) {
                const text = await blob.text();
                content.innerHTML = `<pre style="text-align:left;white-space:pre-wrap;color:var(--text-1);background:var(--bg-input);padding:16px;border-radius:10px;max-height:60vh;overflow:auto;">${escapeHtml(text)}</pre>`;
            } else {
                content.innerHTML = `<p style="color:var(--text-2);padding:24px;">Preview not available for this file type. <br><button class="btn-primary btn-small" onclick="downloadFile(${id})" style="margin-top:12px;"><i class="fas fa-download"></i> Download</button></p>`;
            }
        }
    } catch(err) {
        console.error(err);
        if (content) content.innerHTML = `<p style="color:var(--danger);padding:20px;">Error loading preview: ${err.message}</p>`;
    }
}

function closePreviewModal() {
    const content = document.getElementById('previewContent');
    if (content?.dataset?.blobUrl) { URL.revokeObjectURL(content.dataset.blobUrl); delete content.dataset.blobUrl; }
    if (content) content.innerHTML = '';
    closeModal('previewModal');
}

async function previewSharedFile(id, name, type) {
    const modal   = document.getElementById('previewModal');
    const title   = document.getElementById('previewFileName');
    const content = document.getElementById('previewContent');
    if (title)   title.innerHTML  = `<i class="fas fa-eye"></i> ${escapeHtml(name)}`;
    if (content) content.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-2)"><i class="fas fa-spinner fa-spin"></i> Loading preview…</div>';
    openModal('previewModal');

    const ext = name.split('.').pop().toLowerCase();
    const isOffice = ['doc','docx','xls','xlsx','ppt','pptx'].includes(ext) || 
                     type.includes('word') || type.includes('excel') || type.includes('spreadsheet') || type.includes('powerpoint') || type.includes('presentation');
    const isVideo = type.startsWith('video/') || ['mp4','webm','ogg','avi','mov','mkv'].includes(ext);
    const isAudio = type.startsWith('audio/') || ['mp3','wav','ogg','aac','flac'].includes(ext);

    try {
        const previewUrl = `/api/files/public/preview/${id}`;
        
        if (isOffice) {
            const res = await fetch(`/api/files/public/${id}`);
            const fileData = await res.json();
            const directUrl = fileData.url || `${window.location.origin}${previewUrl}`;
            const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(directUrl)}`;
            content.innerHTML = `<iframe src="${officeUrl}" style="width:100%;height:68vh;border:none;"></iframe>`;
        } else if (isVideo) {
            content.innerHTML = `<video controls autoplay style="max-width:100%;max-height:68vh;background:#000;"><source src="${previewUrl}"></video>`;
        } else if (isAudio) {
            content.innerHTML = `<audio controls autoplay style="width:100%;margin-top:24px;"><source src="${previewUrl}"></audio>`;
        } else if (type.startsWith('image/')) {
            content.innerHTML = `<img src="${previewUrl}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:68vh;object-fit:contain;display:block;margin:0 auto;">`;
        } else if (type === 'application/pdf' || ext === 'pdf') {
            content.innerHTML = `<iframe src="${previewUrl}" style="width:100%;height:68vh;border:none;"></iframe>`;
        } else if (type.startsWith('text/') || ['txt','md','json','js','css','html','xml'].includes(ext)) {
            const res = await fetch(previewUrl);
            if (!res.ok) throw new Error('Preview failed');
            const text = await res.text();
            content.innerHTML = `<pre style="text-align:left;white-space:pre-wrap;color:var(--text-1);background:var(--bg-input);padding:16px;border-radius:10px;max-height:60vh;overflow:auto;">${escapeHtml(text)}</pre>`;
        } else {
            content.innerHTML = `<p style="color:var(--text-2);padding:24px;">Preview not available for this file type. <br><a class="btn-primary btn-small" href="/api/files/public/download/${id}" download style="margin-top:12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;"><i class="fas fa-download"></i> Download</a></p>`;
        }
    } catch(err) {
        console.error(err);
        if (content) content.innerHTML = `<p style="color:var(--danger);padding:20px;">Error loading preview: ${err.message}</p>`;
    }
}


function downloadFile(id) { window.open(`/api/files/download/${id}`, '_blank'); }

// ============================================================
//  DELETE / TRASH / RESTORE
// ============================================================
async function deleteFile(id) {
    const proceed = await showConfirmDialog('Move to Trash', 'Are you sure you want to move this file to the trash?', true);
    if (!proceed) return;
    const res = await fetch(`/api/files/delete/${id}`, { method:'DELETE', credentials: 'include' });
    if (res.ok) {
        showToast('Moved to trash', 'success');
        
        // Check if currently inside a shared folder view
        const sharedMatch = window.location.pathname.match(/^\/shared-folder\/([^\/]+)/);
        if (sharedMatch) {
            const token = sharedMatch[1];
            fetch('/api/auth/me', { credentials: 'include' })
                .then(res => res.json())
                .then(userData => {
                    showSharedFolderLoggedIn(token, userData);
                });
        } else {
            // Optimistic update — remove from local list and update bar immediately
            const deleted = allFiles.find(f => f.id === id);
            allFiles = allFiles.filter(f => f.id !== id);
            if (deleted) {
                const localUsed = allFiles.reduce((s, f) => s + (Number(f.size) || 0), 0);
                updateStorageUI(localUsed, allFiles.length);
            }
            displayFiles(allFiles);
            loadStorageStats(); // confirm with server
        }
    } else { showToast('Failed to move to trash', 'error'); }
}

async function loadTrash() {
    try {
        const res = await fetch('/api/files/trash', { credentials: 'include' });
        if (res.ok) displayTrash(await res.json());
    } catch(e) { console.error(e); }
}

function displayTrash(files) {
    const container = document.getElementById('trashList');
    if (!container) return;
    if (files.length === 0) {
        container.innerHTML = '<div class="empty-state" style="min-height:160px;"><div class="empty-state-icon"><i class="fas fa-trash-alt"></i></div><p>Trash is empty</p></div>';
        return;
    }
    container.innerHTML = files.map(f => `
    <div class="trash-item">
        <div class="trash-info">
            <div>${getFileIcon(f.type, f.id, f.name)}</div>
            <div>
                <div class="trash-name">${escapeHtml(f.name)}</div>
                <div class="trash-meta">${formatFileSize(f.size)} &bull; Deleted: ${formatDateTime(f.deleted_at)}</div>
            </div>
        </div>
        <div class="trash-actions">
            <button onclick="restoreFile(${f.id})" class="btn-primary btn-small" style="background:linear-gradient(135deg,#22c55e,#4ade80);box-shadow:0 2px 10px rgba(34,197,94,0.4);">
                <i class="fas fa-trash-restore"></i> Restore
            </button>
            <button onclick="permanentDeleteFile(${f.id})" class="btn-primary btn-small" style="background:linear-gradient(135deg,#ef4444,#f87171);box-shadow:0 2px 10px rgba(239,68,68,0.4);">
                <i class="fas fa-trash-alt"></i> Delete Forever
            </button>
        </div>
    </div>`).join('');
}

function showTrashView() { openModal('trashModal'); loadTrash(); }
function closeTrashModal() { closeModal('trashModal'); }

async function restoreFile(id) {
    const res = await fetch(`/api/files/restore/${id}`, { method:'POST', credentials: 'include' });
    if (res.ok) { showToast('File restored!', 'success'); loadTrash(); loadFiles(); loadStorageStats(); }
    else { showToast('Restore failed', 'error'); }
}

async function permanentDeleteFile(id) {
    const proceed = await showConfirmDialog('Delete Forever ⚠️', 'This file will be permanently deleted. This action cannot be undone. Are you sure?', true);
    if (!proceed) return;
    const res = await fetch(`/api/files/permanent/${id}`, { method:'DELETE', credentials: 'include' });
    if (res.ok) { showToast('Permanently deleted', 'success'); loadTrash(); loadStorageStats(); }
    else { showToast('Delete failed', 'error'); }
}

// ============================================================
//  PROFILE
// ============================================================
async function loadUserProfile() {
    try {
        const res = await fetch('/api/auth/profile', { credentials: 'include' });
        if (!res.ok) return;
        const user = await res.json();
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = user.name || user.email?.split('@')[0] || 'User';
        const avatarEl = document.getElementById('profileAvatar');
        if (avatarEl && user.profile_picture && user.profile_picture !== '/uploads/default-avatar.png') {
            avatarEl.src = user.profile_picture + '?t=' + Date.now();
        }
        window.currentProfile = user;
    } catch(e) { console.error('Profile load failed', e); }
}

function openProfileModal() {
    const modalPic  = document.getElementById('modalProfilePic');
    const nameInput = document.getElementById('profileNameInput');
    if (window.currentProfile) {
        if (modalPic)   modalPic.src    = window.currentProfile.profile_picture || '/uploads/default-avatar.png';
        if (nameInput)  nameInput.value = window.currentProfile.name || '';
    } else {
        if (modalPic)   modalPic.src    = '/uploads/default-avatar.png';
        if (nameInput)  nameInput.value = '';
    }
    const pmsg = document.getElementById('profileMessage'); if (pmsg) pmsg.innerHTML = '';
    openModal('profileModal');
}

function closeProfileModal() { closeModal('profileModal'); }

function showProfileMessage(msg, type) {
    const el = document.getElementById('profileMessage');
    if (!el) return;
    el.innerHTML = msg; el.className = `message ${type}`;
    setTimeout(() => { if (el.innerHTML === msg) el.innerHTML = ''; }, 3000);
}

async function updateProfileName() {
    const name = document.getElementById('profileNameInput')?.value.trim();
    if (!name) { showProfileMessage('Name cannot be empty', 'error'); return; }
    const res = await fetch('/api/auth/profile/name', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials: 'include', body:JSON.stringify({ name }) });
    if (res.ok) {
        showProfileMessage('Name updated!', 'success');
        const el = document.getElementById('userName'); if (el) el.textContent = name;
        if (window.currentProfile) window.currentProfile.name = name;
        setTimeout(() => closeProfileModal(), 900);
    } else {
        const data = await res.json();
        showProfileMessage(data.error || 'Update failed', 'error');
    }
}


async function uploadProfilePicture(input) {
    const file = input.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('profile_pic', file);
    const res  = await fetch('/api/auth/profile/picture', { method:'POST', credentials: 'include', body:fd });
    const data = await res.json();
    if (res.ok) {
        showProfileMessage('Picture updated!', 'success');
        const newSrc = data.profile_picture + '?t=' + Date.now();
        const a = document.getElementById('profileAvatar'); if (a) a.src = newSrc;
        const m = document.getElementById('modalProfilePic'); if (m) m.src = newSrc;
        if (window.currentProfile) window.currentProfile.profile_picture = data.profile_picture;
        setTimeout(() => closeProfileModal(), 900);
    } else { showProfileMessage(data.error || 'Upload failed', 'error'); }
    input.value = '';
}

// ============================================================
//  CHANGE PASSWORD (standalone modal)
// ============================================================
function changePasswordDialog() {
    ['currentPassword','newPasswordModal'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const msg = document.getElementById('changePasswordMessage'); if (msg) msg.innerHTML = '';
    openModal('changePasswordModal');
}
function closeChangePasswordModal() { closeModal('changePasswordModal'); }

async function submitChangePassword() {
    const curr = document.getElementById('currentPassword')?.value;
    const newp = document.getElementById('newPasswordModal')?.value;
    if (!curr || !newp) { showMessage('changePasswordMessage', 'Please fill all fields', 'error'); return; }
    if (newp.length < 6) { showMessage('changePasswordMessage', 'Min 6 characters', 'error'); return; }
    const res  = await fetch('/api/auth/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, credentials: 'include', body:JSON.stringify({ currentPassword:curr, newPassword:newp }) });
    const data = await res.json();
    if (res.ok) {
        showMessage('changePasswordMessage', 'Password changed successfully!', 'success');
        setTimeout(() => closeChangePasswordModal(), 1800);
    } else { showMessage('changePasswordMessage', data.error, 'error'); }
}

// ============================================================
//  FORGOT PASSWORD — EMAIL OTP VERIFICATION
// ============================================================
let forgotResendInterval = null;

function openForgotPassword() {
    // Reset everything
    const el = document.getElementById('forgotEmail'); if (el) el.value = '';
    const np = document.getElementById('forgotNewPassword'); if (np) np.value = '';
    document.querySelectorAll('.otp-input').forEach(i => i.value = '');
    const msg = document.getElementById('forgotMessage'); if (msg) msg.innerHTML = '';

    // Show step 1, hide others
    showForgotStep(1);
    openModal('forgotPasswordModal');
}

function closeForgotPassword() {
    if (forgotResendInterval) { clearInterval(forgotResendInterval); forgotResendInterval = null; }
    closeModal('forgotPasswordModal');
}

function showForgotStep(step) {
    // Hide all step contents
    for (let i = 1; i <= 3; i++) {
        const s = document.getElementById(`forgotStep${i}`);
        if (s) s.style.display = i === step ? 'block' : 'none';
    }
    // Update step dots
    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`forgotStep${i}Dot`);
        if (dot) {
            dot.classList.remove('active', 'done');
            if (i < step) dot.classList.add('done');
            else if (i === step) dot.classList.add('active');
        }
    }
    // Clear message
    const msg = document.getElementById('forgotMessage'); if (msg) msg.innerHTML = '';
}

// Step 1: Send verification code
async function sendForgotCode() {
    const email = document.getElementById('forgotEmail')?.value.trim();
    if (!email) {
        showMessage('forgotMessage', 'Please enter your email', 'error');
        return;
    }

    const btn = document.getElementById('forgotSendBtn');
    const originalText = btn?.innerHTML;
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'; btn.disabled = true; }

    try {
        const res = await fetch('/api/auth/forgot-password/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (res.ok) {
            // Show step 2
            const emailDisplay = document.getElementById('forgotEmailDisplay');
            if (emailDisplay) emailDisplay.textContent = email;
            showForgotStep(2);
            startResendCountdown();
            // Focus first OTP input
            const firstOtp = document.querySelector('.otp-input[data-index="0"]');
            if (firstOtp) setTimeout(() => firstOtp.focus(), 300);
        } else {
            showMessage('forgotMessage', data.error || 'Failed to send code', 'error');
        }
    } catch (err) {
        showMessage('forgotMessage', 'Server error — please try again', 'error');
    }

    if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
}

// Resend countdown (60 seconds)
function startResendCountdown() {
    const timerEl = document.getElementById('forgotResendTimer');
    const countdownEl = document.getElementById('forgotCountdown');
    const resendBtn = document.getElementById('forgotResendBtn');

    if (timerEl) timerEl.style.display = 'inline';
    if (resendBtn) resendBtn.style.display = 'none';

    let seconds = 60;
    if (countdownEl) countdownEl.textContent = seconds;

    if (forgotResendInterval) clearInterval(forgotResendInterval);
    forgotResendInterval = setInterval(() => {
        seconds--;
        if (countdownEl) countdownEl.textContent = seconds;
        if (seconds <= 0) {
            clearInterval(forgotResendInterval);
            forgotResendInterval = null;
            if (timerEl) timerEl.style.display = 'none';
            if (resendBtn) resendBtn.style.display = 'inline-flex';
        }
    }, 1000);
}

// Step 2: Verify code
async function verifyForgotCode() {
    const email = document.getElementById('forgotEmail')?.value.trim();
    const otpInputs = document.querySelectorAll('.otp-input');
    let code = '';
    otpInputs.forEach(inp => code += inp.value);

    if (code.length !== 6) {
        showMessage('forgotMessage', 'Please enter the complete 6-digit code', 'error');
        return;
    }

    const btn = document.getElementById('forgotVerifyBtn');
    const originalText = btn?.innerHTML;
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...'; btn.disabled = true; }

    try {
        const res = await fetch('/api/auth/forgot-password/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();

        if (res.ok) {
            if (forgotResendInterval) { clearInterval(forgotResendInterval); forgotResendInterval = null; }
            showForgotStep(3);
            // Focus password input
            const pwInput = document.getElementById('forgotNewPassword');
            if (pwInput) setTimeout(() => pwInput.focus(), 300);
        } else {
            showMessage('forgotMessage', data.error || 'Invalid code', 'error');
            // Shake OTP inputs on error
            otpInputs.forEach(inp => {
                inp.classList.add('otp-shake');
                setTimeout(() => inp.classList.remove('otp-shake'), 500);
            });
        }
    } catch (err) {
        showMessage('forgotMessage', 'Server error — please try again', 'error');
    }

    if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
}

// Step 3: Reset password
async function submitForgotReset() {
    const email = document.getElementById('forgotEmail')?.value.trim();
    const newPassword = document.getElementById('forgotNewPassword')?.value;

    if (!newPassword) {
        showMessage('forgotMessage', 'Please enter a new password', 'error');
        return;
    }
    if (newPassword.length < 6) {
        showMessage('forgotMessage', 'Password must be at least 6 characters', 'error');
        return;
    }

    const btn = document.getElementById('forgotResetBtn');
    const originalText = btn?.innerHTML;
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...'; btn.disabled = true; }

    try {
        const res = await fetch('/api/auth/forgot-password/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, newPassword })
        });
        const data = await res.json();

        if (res.ok) {
            showMessage('forgotMessage', 'Password updated successfully! 🎉', 'success');
            setTimeout(() => {
                closeForgotPassword();
                showAuthTab('login');
            }, 2000);
        } else {
            showMessage('forgotMessage', data.error || 'Reset failed', 'error');
        }
    } catch (err) {
        showMessage('forgotMessage', 'Server error — please try again', 'error');
    }

    if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
}

// OTP Input Handlers — auto-focus, backspace, paste
document.addEventListener('DOMContentLoaded', () => {
    const otpInputs = document.querySelectorAll('.otp-input');

    otpInputs.forEach((input, idx) => {
        // Only allow digits
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val;
            if (val && idx < otpInputs.length - 1) {
                otpInputs[idx + 1].focus();
            }
        });

        // Backspace: go to previous
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && idx > 0) {
                otpInputs[idx - 1].focus();
                otpInputs[idx - 1].value = '';
            }
            // Enter: verify
            if (e.key === 'Enter') verifyForgotCode();
        });

        // Paste: fill all 6 inputs
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            pasted.split('').forEach((char, i) => {
                if (otpInputs[i]) otpInputs[i].value = char;
            });
            if (pasted.length >= 6) otpInputs[5].focus();
            else if (otpInputs[pasted.length]) otpInputs[pasted.length].focus();
        });

        // Select on focus
        input.addEventListener('focus', () => input.select());
    });
});


// ============================================================
//  MODAL HELPERS
// ============================================================
function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}
// Close modal on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) closeModal(e.target.id);
});
// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => {
            if (m.style.display === 'flex') closeModal(m.id);
        });
    }
});

// ============================================================
//  UTILITY
// ============================================================
function showMessage(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = msg; el.className = `message ${type}`;
    setTimeout(() => { if (el.innerHTML === msg) el.innerHTML = ''; }, 5000);
}

// ============================================================
//  PARTICLES (subtle background)
// ============================================================
function createParticle() {
    const bg = document.querySelector('.bg-animation'); if (!bg) return;
    const p  = document.createElement('div');
    p.className = 'particle';
    const s = Math.random() * 5 + 2;
    p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random()*100}%;animation-duration:${Math.random()*10+10}s;animation-delay:${Math.random()*4}s;opacity:${Math.random()*0.4+0.1};background:rgba(108,99,255,${Math.random()*0.4+0.1});border-radius:50%;position:absolute;animation-name:particleFloat;animation-timing-function:linear;animation-iteration-count:infinite;`;
    bg.appendChild(p);
    setTimeout(() => p.remove(), 20000);
}
setInterval(() => { if (Math.random() > 0.5) createParticle(); }, 3000);

// ============================================================
//  CUSTOM CONFIRMATION DIALOG
// ============================================================
function showConfirmDialog(title, message, isDanger = true) {
    return new Promise((resolve) => {
        const modal     = document.getElementById('confirmModal');
        const titleEl   = document.getElementById('confirmTitle');
        const msgEl     = document.getElementById('confirmMessage');
        const iconEl    = document.getElementById('confirmIcon');
        const yesBtn    = document.getElementById('confirmYesBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        if (!modal || !yesBtn || !cancelBtn) {
            resolve(confirm(message));
            return;
        }

        titleEl.textContent = title || 'Are you sure?';
        msgEl.textContent   = message || 'Do you want to proceed?';

        if (isDanger) {
            iconEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            iconEl.style.background = 'rgba(239, 68, 68, 0.08)';
            iconEl.style.color      = 'var(--danger)';
            iconEl.style.borderColor = 'rgba(239, 68, 68, 0.2)';
            yesBtn.style.background  = 'linear-gradient(135deg, #ef4444, #f87171)';
            yesBtn.style.boxShadow   = '0 4px 16px rgba(239, 68, 68, 0.35)';
            yesBtn.textContent       = 'Yes, Delete';
        } else {
            iconEl.innerHTML = '<i class="fas fa-info-circle"></i>';
            iconEl.style.background = 'var(--accent-sub)';
            iconEl.style.color      = 'var(--accent)';
            iconEl.style.borderColor = 'var(--border-accent)';
            yesBtn.style.background  = 'var(--btn-grad)';
            yesBtn.style.boxShadow   = 'var(--btn-shadow)';
            yesBtn.textContent       = 'Confirm';
        }

        openModal('confirmModal');

        const onYes = () => {
            closeModal('confirmModal');
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            closeModal('confirmModal');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            yesBtn.removeEventListener('click', onYes);
            cancelBtn.removeEventListener('click', onCancel);
        };

        yesBtn.addEventListener('click', onYes);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ============================================================
//  PUBLIC SHARE PREVIEW SYSTEM
// ============================================================
async function checkPublicShareRoute() {
    const path = window.location.pathname;
    let match = path.match(/^\/(?:share\/file|s)\/([^\/]+)/);
    if (match) {
        const fileId = match[1];
        showPublicPreviewLayout();
        loadPublicFilePreview(fileId);
        return true;
    }

    match = path.match(/^\/shared-folder\/([^\/]+)/);
    if (match) {
        const token = match[1];

        // Check if user is logged in
        try {
            const authRes = await fetch('/api/auth/me', { credentials: 'include' });
            if (authRes.ok) {
                const userData = await authRes.json();
                // User is logged in — show full app with sidebar
                await showSharedFolderLoggedIn(token, userData);
                return true;
            }
        } catch(e) {}

        // Not logged in — show public preview
        showPublicPreviewLayout();
        loadPublicFolderPreview(token);
        return true;
    }

    return false;
}

// Show shared folder inside the full app (with sidebar) for logged-in users
async function showSharedFolderLoggedIn(token, userData) {
    // Show full app dashboard with sidebar
    const authPage = document.getElementById('authPage');
    const appPage  = document.getElementById('appPage');
    const pubPage  = document.getElementById('publicPreviewPage');
    if (authPage) authPage.style.display = 'none';
    if (appPage)  appPage.style.display  = 'flex';
    if (pubPage)  pubPage.style.display  = 'none';

    // Hide loader immediately so layout is interactive
    hideInitSpinner();

    // Set user email in topbar
    const emailEl = document.getElementById('userEmail');
    if (emailEl) emailEl.textContent = userData.email;

    // Load user profile, storage stats, start polling
    loadUserProfile();
    loadStorageStats();
    startStoragePolling();

    // Update sidebar active state
    activeNav = 'shared';
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('navSharedWithMe')?.classList.add('active');

    // Hide breadcrumb and upload dropzone
    const breadcrumbBar = document.getElementById('breadcrumbBar');
    if (breadcrumbBar) breadcrumbBar.style.display = 'none';
    const dropzone = document.getElementById('uploadDropzone');
    if (dropzone) dropzone.style.display = 'none';

    // Show loading in fileList
    const container = document.getElementById('fileList');
    if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-2);grid-column:1/-1;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:12px;">Loading shared folder...</p></div>';

    // Remove old upload sections if they exist
    const oldUpload = document.getElementById('inAppFolderUpload');
    if (oldUpload) oldUpload.remove();

    try {
        const res  = await fetch(`/api/folders/public/${token}`);
        const data = await res.json();

        if (!res.ok || !data || data.error) {
            if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);grid-column:1/-1;"><i class="fas fa-exclamation-triangle fa-2x"></i><p style="margin-top:12px;">${data.error || 'Folder not found or expired.'}</p></div>`;
            return;
        }

        // Save files to global allFiles so sharing/actions can look them up
        allFiles = data.files || [];

        // Set global sharedFolderId for uploads
        if (data.folder && data.folder.id) sharedFolderId = data.folder.id;

        // Check if already accepted (use backend value as source of truth)
        const alreadyAccepted = data.alreadyAccepted === true;

        // Update content title with Accept / Accepted badge
        const titleEl = document.getElementById('contentTitle');
        if (titleEl) {
            if (alreadyAccepted) {
                titleEl.innerHTML = `${escapeHtml(data.folder.name)}
                    <span style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;background:rgba(134,239,172,0.15);color:#86efac;border:1px solid rgba(134,239,172,0.3);padding:3px 10px;border-radius:99px;vertical-align:middle;margin-left:10px;">
                        <i class="fas fa-check-circle"></i> Saved to Shared with me
                    </span>
                    <a href="/?view=shared" style="font-size:0.8rem;color:var(--accent);margin-left:10px;vertical-align:middle;text-decoration:none;">View all →</a>`;
            } else {
                titleEl.innerHTML = `${escapeHtml(data.folder.name)}
                    <button id="acceptFolderBtn" onclick="acceptSharedFolderInvitation('${token}')"
                        style="margin-left:12px;font-size:0.82rem;vertical-align:middle;display:inline-flex;align-items:center;gap:6px;
                                background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;padding:6px 14px;
                                border-radius:8px;cursor:pointer;font-weight:600;">
                        <i class="fas fa-check-circle"></i> Accept & Save to Shared with Me
                    </button>`;
            }
        }

        // Build upload section (place it before the grid container ONLY if user has Editor role)
        if (data.userRole === 'editor') {
            const uploadDiv = document.createElement('div');
            uploadDiv.id = 'inAppFolderUpload';
            uploadDiv.style.cssText = 'margin-bottom:20px;padding:16px 20px;background:rgba(139,92,246,0.06);border:2px dashed rgba(139,92,246,0.3);border-radius:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;';
            uploadDiv.innerHTML = `
                <label for="inAppFolderFileInput" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:9px 18px;border-radius:10px;font-size:0.88rem;font-weight:600;transition:all 0.2s;box-shadow:0 4px 12px rgba(124,58,237,0.25);">
                    <i class="fas fa-cloud-upload-alt"></i> Upload to this Folder
                </label>
                <input type="file" id="inAppFolderFileInput" style="display:none;" onchange="uploadFile(this)">
                <p style="margin:0;font-size:0.82rem;color:var(--text-2);">Files will be added to <strong>${escapeHtml(data.folder.name)}</strong></p>`;
            
            container.parentNode.insertBefore(uploadDiv, container);
        }

        // Build file list (based on grid vs list view)
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-2);grid-column:1/-1;"><i class="fas fa-folder-open fa-2x" style="opacity:0.4;"></i><p style="margin-top:12px;">This shared folder is empty.</p></div>';
        } else {
            if (currentView === 'grid') {
                container.className = "file-container grid-view";
                container.innerHTML = data.files.map(f => `
                    <div class="file-card">
                        <div class="file-icon">${getFileIcon(f.type, f.id, f.name)}</div>
                        <div class="file-name" title="${escapeHtml(f.name)}">${truncateName(f.name, 22)}</div>
                        <div class="file-size">${formatFileSize(f.size)}</div>
                        <div class="file-date"><i class="fas fa-calendar-alt"></i> ${formatDateTime(f.uploaded_at)}</div>
                        <div class="file-actions">
                            <button title="Preview" onclick="previewSharedFile('${f.id}', '${escapeHtml(f.name)}', '${f.type}')"><i class="fas fa-eye"></i></button>
                            <button title="Download" onclick="window.location.href='/api/files/public/download/${f.id}'"><i class="fas fa-download"></i></button>
                            <button title="Share Link" onclick="shareFile('${f.id}')"><i class="fas fa-link"></i></button>
                            ${data.userRole === 'editor' ? `<button title="Delete" onclick="deleteFile('${f.id}')" style="color:var(--danger,#ef4444);"><i class="fas fa-trash-alt"></i></button>` : ''}
                        </div>
                    </div>`).join('');
            } else {
                container.className = "file-container list-view";
                container.innerHTML = data.files.map(f => `
                    <div class="file-list-item">
                        <div class="file-list-info" style="flex:1;">
                            <div class="file-list-icon">${getFileIcon(f.type, f.id, f.name)}</div>
                            <div class="file-list-details">
                                <div class="file-list-name">${escapeHtml(f.name)}</div>
                                <div class="file-list-meta">${formatFileSize(f.size)} &bull; <i class="fas fa-calendar-alt"></i> ${formatDateTime(f.uploaded_at)}</div>
                            </div>
                        </div>
                        <div class="file-list-actions">
                            <button title="Preview" onclick="previewSharedFile('${f.id}', '${escapeHtml(f.name)}', '${f.type}')"><i class="fas fa-eye"></i></button>
                            <button title="Download" onclick="window.location.href='/api/files/public/download/${f.id}'"><i class="fas fa-download"></i></button>
                            <button title="Share Link" onclick="shareFile('${f.id}')"><i class="fas fa-link"></i></button>
                            ${data.userRole === 'editor' ? `<button title="Delete" onclick="deleteFile('${f.id}')" style="color:var(--danger,#ef4444);"><i class="fas fa-trash-alt"></i></button>` : ''}
                        </div>
                    </div>`).join('');
            }
        }

    } catch(err) {
        console.error('Failed to load shared folder in app:', err);
        if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);grid-column:1/-1;"><i class="fas fa-exclamation-triangle fa-2x"></i><p style="margin-top:12px;">Failed to load shared folder.</p></div>';
    }
}

function showPublicPreviewLayout() {
    const authPage = document.getElementById('authPage');
    const appPage  = document.getElementById('appPage');
    const pubPage  = document.getElementById('publicPreviewPage');
    if (authPage) authPage.style.display = 'none';
    if (appPage)  appPage.style.display  = 'none';
    if (pubPage)  pubPage.style.display  = 'flex';
}

async function loadPublicFilePreview(fileId) {
    const loading    = document.getElementById('publicLoading');
    const errorBox   = document.getElementById('publicError');
    const contentBox = document.getElementById('publicContent');
    const folderBox  = document.getElementById('publicFolderContent');

    if (loading)    loading.style.display    = 'block';
    if (errorBox)   errorBox.style.display   = 'none';
    if (contentBox) contentBox.style.display = 'none';
    if (folderBox)  folderBox.style.display  = 'none';

    try {
        const res  = await fetch(`/api/files/public/${fileId}`);
        const file = await res.json();

        if (!res.ok || !file || file.error) {
            if (loading) loading.style.display = 'none';
            if (errorBox) {
                errorBox.style.display = 'block';
                const msg = document.getElementById('publicErrorMsg');
                if (msg) msg.textContent = file.error || 'This shared file could not be found or has been deleted.';
            }
            return;
        }

        const iconEl = document.getElementById('pubFileIcon');
        const nameEl = document.getElementById('pubFileName');
        const typeEl = document.getElementById('pubFileType');
        const sizeEl = document.getElementById('pubFileSize');
        const dateEl = document.getElementById('pubFileDate');
        const dlBtn  = document.getElementById('pubDownloadBtn');

        const fileName = file.name || 'Shared File';
        const fileType = file.type || 'application/octet-stream';
        const fileSize = file.size || 0;
        const publicPreviewUrl  = `/api/files/public/preview/${fileId}`;
        const publicDownloadUrl = `/api/files/public/download/${fileId}`;

        if (nameEl) nameEl.textContent = fileName;
        if (typeEl) typeEl.textContent = (fileName.split('.').pop() || 'file').toUpperCase();
        if (sizeEl) sizeEl.textContent = formatFileSize(fileSize);
        if (dateEl) dateEl.textContent = file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        if (iconEl) iconEl.innerHTML   = getFileIcon(fileType, fileId, fileName);

        if (dlBtn)  dlBtn.href  = publicDownloadUrl;

        // Render Media Preview
        renderPublicMediaPreview(fileId, fileName, fileType, file.url || publicPreviewUrl);

        if (loading)    loading.style.display    = 'none';
        if (contentBox) contentBox.style.display = 'block';

    } catch (err) {
        console.error('Failed to load public file preview:', err);
        if (loading)  loading.style.display  = 'none';
        if (errorBox) errorBox.style.display = 'block';
    }
}

function renderPublicMediaPreview(fileId, fileName, mimeType, directUrl) {
    const mediaBox = document.getElementById('pubMediaBox');
    if (!mediaBox) return;
    mediaBox.innerHTML = '';

    const ext = fileName.split('.').pop().toLowerCase();
    const publicPreviewUrl = `/api/files/public/preview/${fileId}`;

    if (mimeType.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
        mediaBox.innerHTML = `<img src="${publicPreviewUrl}" alt="${escapeHtml(fileName)}" onclick="window.open('${directUrl}','_blank')" title="Click to view full size">`;
    } else if (mimeType.startsWith('video/') || ['mp4','webm','ogg','mov','mkv'].includes(ext)) {
        mediaBox.innerHTML = `<video controls playsinline preload="metadata" src="${publicPreviewUrl}"></video>`;
    } else if (mimeType.startsWith('audio/') || ['mp3','wav','ogg','m4a','aac'].includes(ext)) {
        mediaBox.innerHTML = `<audio controls src="${publicPreviewUrl}"></audio>`;
    } else if (mimeType === 'application/pdf' || ext === 'pdf') {
        mediaBox.innerHTML = `<iframe src="${publicPreviewUrl}"></iframe>`;
    } else if (['txt','js','json','html','css','py','md','csv','xml','c','cpp','java','log'].includes(ext) || mimeType.startsWith('text/')) {
        mediaBox.innerHTML = `<div class="public-loading"><i class="fas fa-spinner fa-spin"></i> Loading text content…</div>`;
        fetch(publicPreviewUrl)
            .then(res => res.text())
            .then(text => {
                mediaBox.innerHTML = `<pre class="public-text-preview"><code>${escapeHtml(text.slice(0, 100000))}</code></pre>`;
            })
            .catch(() => {
                mediaBox.innerHTML = `<div class="public-fallback-preview"><i class="fas fa-file-alt public-fallback-icon"></i><p>Could not preview text content.</p></div>`;
            });
    } else {
        mediaBox.innerHTML = `
            <div class="public-fallback-preview">
                <div class="public-fallback-icon">${getFileIcon(mimeType, fileId, fileName)}</div>
                <p style="font-weight:600;font-size:1.1rem;color:var(--text-1);margin-bottom:6px;">${escapeHtml(fileName)}</p>
                <p>No inline preview available for this format.</p>
            </div>
        `;
    }
}

async function loadPublicFolderPreview(token) {
    const loading    = document.getElementById('publicLoading');
    const errorBox   = document.getElementById('publicError');
    const contentBox = document.getElementById('publicContent');
    const folderBox  = document.getElementById('publicFolderContent');

    if (loading)    loading.style.display    = 'block';
    if (errorBox)   errorBox.style.display   = 'none';
    if (contentBox) contentBox.style.display = 'none';
    if (folderBox)  folderBox.style.display  = 'none';

    try {
        const res  = await fetch(`/api/folders/public/${token}`);
        const data = await res.json();

        if (!res.ok || !data || data.error) {
            if (loading) loading.style.display = 'none';
            if (errorBox) {
                errorBox.style.display = 'block';
                const msg = document.getElementById('publicErrorMsg');
                if (msg) msg.textContent = data.error || 'Shared folder not found or expired.';
            }
            return;
        }

        // Set global sharedFolderId so uploadFile() sends to the right folder
        if (data.folder && data.folder.id) {
            sharedFolderId = data.folder.id;
        }

        const nameEl  = document.getElementById('pubFolderName');
        const countEl = document.getElementById('pubFolderFileCount');
        const listEl  = document.getElementById('pubFolderFileList');

        // Check if already accepted (localStorage)
        const currentUserEmail = (document.getElementById('userEmail')?.textContent || '').trim().toLowerCase();
        let alreadyAccepted = false;
        if (currentUserEmail) {
            const localKey = `pd_accepted_folders_${currentUserEmail}`;
            const saved = JSON.parse(localStorage.getItem(localKey) || '[]');
            alreadyAccepted = saved.some(f =>
                f.share_token === token || String(f.id) === String(data.folder && data.folder.id)
            );
        }

        if (nameEl) {
            if (alreadyAccepted) {
                nameEl.innerHTML = `${escapeHtml(data.folder.name)}
                    <span style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;background:rgba(134,239,172,0.15);color:#86efac;border:1px solid rgba(134,239,172,0.3);padding:3px 10px;border-radius:99px;vertical-align:middle;margin-left:10px;">
                        <i class="fas fa-check-circle"></i> Saved to Shared with me
                    </span>
                    <a href="/?view=shared" style="font-size:0.85rem;color:var(--accent,#7c3aed);margin-left:10px;vertical-align:middle;text-decoration:none;">View all →</a>`;
            } else {
                nameEl.innerHTML = `${escapeHtml(data.folder.name)} <button class="btn-primary-sm" onclick="acceptSharedFolderInvitation('${token}')" style="margin-left:14px;font-size:0.85rem;vertical-align:middle;display:inline-flex;align-items:center;gap:6px;"><i class="fas fa-check-circle"></i> Accept &amp; Save to Shared with Me</button>`;
            }
        }
        if (countEl) countEl.textContent = `${data.files ? data.files.length : 0} file(s)`;

        // Show upload section ONLY if user has Editor permission
        if (data.userRole === 'editor') {
            const existingUploadSection = document.getElementById('pubFolderUploadSection');
            if (!existingUploadSection && folderBox) {
                const uploadSection = document.createElement('div');
                uploadSection.id = 'pubFolderUploadSection';
                uploadSection.style.cssText = 'margin:16px 0;padding:16px;background:rgba(139,92,246,0.08);border:2px dashed rgba(139,92,246,0.35);border-radius:12px;text-align:center;';
                uploadSection.innerHTML = `
                    <label for="pubFolderFileInput" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:9px 20px;border-radius:8px;font-size:0.9rem;font-weight:600;">
                        <i class="fas fa-cloud-upload-alt"></i> Upload to this Folder
                    </label>
                    <input type="file" id="pubFolderFileInput" style="display:none;" onchange="uploadFile(this)">
                    <p style="margin-top:8px;font-size:0.78rem;color:var(--text-2,#94a3b8);">Files will be added to <strong>${escapeHtml(data.folder.name)}</strong></p>
                `;
                // Insert before the file list
                const listParent = listEl ? listEl.parentNode : null;
                if (listParent) listParent.insertBefore(uploadSection, listEl);
            }
        } else {
            const existingUploadSection = document.getElementById('pubFolderUploadSection');
            if (existingUploadSection) existingUploadSection.remove();
        }

        if (listEl) {
            if (!data.files || data.files.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-2);">This shared folder is empty.</div>';
            } else {
                listEl.innerHTML = data.files.map(f => `
                    <div class="pub-folder-file-item">
                        <div class="pub-folder-file-left">
                            ${getFileIcon(f.type, f.id, f.name)}
                            <div>
                                <div class="pub-folder-file-name">${escapeHtml(f.name)}</div>
                                <div class="pub-folder-file-sub">${formatFileSize(f.size)} &bull; ${f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString() : ''}</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <button class="btn-secondary-action" style="padding:6px 10px;font-size:0.85rem;" title="Copy share link" onclick="navigator.clipboard.writeText(window.location.origin + '/share/file/${f.id}').then(() => pdToast('success', 'Copied!', 'Link copied to clipboard.', 2000))">
                                <i class="fas fa-link"></i>
                            </button>
                            <a href="/share/file/${f.id}" target="_blank" class="btn-secondary-action" style="padding:6px 14px;font-size:0.85rem;">
                                <i class="fas fa-eye"></i> Preview
                            </a>
                            <a href="/api/files/public/download/${f.id}" download class="btn-primary-sm" style="display:inline-flex;align-items:center;gap:6px;">
                                <i class="fas fa-download"></i> Download
                            </a>
                        </div>
                    </div>
                `).join('');
            }
        }

        if (loading)   loading.style.display   = 'none';
        if (folderBox) folderBox.style.display = 'block';

    } catch (err) {
        console.error('Failed to load public folder preview:', err);
        if (loading)  loading.style.display  = 'none';
        if (errorBox) errorBox.style.display = 'block';
    }
}


async function acceptSharedFolderInvitation(token) {
    try {
        const res = await fetch(`/api/folders/accept/${token}`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            try {
                const currentUserEmail = (document.getElementById('userEmail')?.textContent || '').trim().toLowerCase();
                const localStorageKey = currentUserEmail ? `pd_accepted_folders_${currentUserEmail}` : 'pd_accepted_folders_anonymous';
                let saved = JSON.parse(localStorage.getItem(localStorageKey) || '[]');
                if (!Array.isArray(saved)) saved = [];
                const folderId = data.folder ? data.folder.id : token;
                const folderName = data.folder ? data.folder.name : 'Shared Folder';
                if (!saved.some(f => f.share_token === token || String(f.id) === String(folderId))) {
                    saved.push({
                        id: folderId,
                        name: folderName,
                        share_token: token,
                        shareUrl: `/shared-folder/${token}`,
                        owner_name: 'Folder Collaborator',
                        owner_email: 'Shared Link',
                        file_count: 0
                    });
                    localStorage.setItem(localStorageKey, JSON.stringify(saved));
                }
            } catch(e) {}

            pdToast('success', 'Invitation Accepted! 🎉', data.message || 'Folder added to Shared with me.', 4000);
            setTimeout(() => {
                window.location.href = '/?view=shared';
            }, 1000);
        } else {
            pdToast('info', 'Login Required', 'Please log in to accept this invitation.', 3000);
            sessionStorage.setItem('pd_post_login_redirect', window.location.pathname);
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
        }
    } catch(err) {
        pdToast('warning', 'Login Required', 'Please log in to accept this invitation.', 3000);
        sessionStorage.setItem('pd_post_login_redirect', window.location.pathname);
        setTimeout(() => {
            window.location.href = '/';
        }, 1500);
    }
}

function copyPublicShareLink() {
    const copyBtn = document.getElementById('pubCopyBtn');
    navigator.clipboard.writeText(window.location.href).then(() => {
        if (copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy Link';
            }, 2500);
        }
        showToast('🔗 Link copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Link copied!', 'success');
    });
}

// ============================================================
//  INIT
// ============================================================
window.addEventListener('popstate', async () => {
    const path = window.location.pathname;
    if (path === '/shared-with-me' || path === '/shared') {
        switchView('shared');
    } else if (path === '/' || path === '') {
        switchView('drive');
    } else {
        await checkPublicShareRoute();
    }
});

(async () => {
    if (!await checkPublicShareRoute()) {
        checkAuth();
    }
})();