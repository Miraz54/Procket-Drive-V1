require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const folderRoutes = require('./routes/folders');
const { apiLimiter } = require('./lib/security');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    app.set('trust proxy', 1);
}

app.use((req, res, next) => {
    // Support comma-separated list of allowed origins via env var
    const rawOrigins = process.env.ALLOWED_ORIGIN
        || (isProduction ? 'https://procket-drive-v1.vercel.app' : 'http://localhost:3000');
    const allowedOrigins = rawOrigins.split(',').map(o => o.trim());
    const requestOrigin  = req.headers.origin;
    const corsOrigin     = allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : allowedOrigins[0];
    res.header('Access-Control-Allow-Origin', corsOrigin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});


app.get('/ping', (req, res) => res.send('pong'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,           
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',  
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Global API Rate Limiting
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/folders', folderRoutes);
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;