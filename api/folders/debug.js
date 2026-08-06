const supabase = require('../../lib/supabase');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        let userEmail = '';
        const { data: user } = await supabase.from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();
        if (user) userEmail = user.email;

        // Fetch shares from folder_shares table
        const { data: shares, error: sharesErr } = await supabase.from('folder_shares')
            .select('*');

        // Fetch folders
        const { data: folders, error: foldersErr } = await supabase.from('folders')
            .select('*');

        res.json({
            userId,
            userEmail,
            shares: shares || [],
            sharesError: sharesErr || null,
            foldersCount: folders ? folders.length : 0,
            foldersError: foldersErr || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
