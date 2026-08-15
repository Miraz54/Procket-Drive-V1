// lib/virusScanner.js — Lightweight Virus & Malware Scanning Engine
const crypto = require('crypto');

// EICAR Standard Anti-Virus Test File Signature (Industry standard for testing virus detection)
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// Malicious payload patterns / WebShell signatures
const MALICIOUS_PATTERNS = [
    /<\?php\s+(eval|system|exec|passthru|shell_exec|base64_decode)/i,
    /eval\s*\(\s*gzinflate\s*\(\s*base64_decode/i,
    /eval\s*\(\s*base64_decode\s*\(/i,
    /<%@\s*Page\s+Language=/i, // ASP.NET webshell
    /WScript\.Shell/i,
    /powershell\s+-enc/i,
    /cmd\.exe\s+\/c/i
];

/**
 * Calculates the SHA-256 hash of a file buffer
 * @param {Buffer} buffer 
 * @returns {string} Hex SHA-256 string
 */
function getFileSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Scans a file buffer for known malware signatures and webshell payloads
 * Optionally queries the VirusTotal API if VIRUSTOTAL_API_KEY is configured in .env
 * 
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {string} filename - Original filename
 * @param {string} mimetype - MIME type
 * @returns {Promise<{ isInfected: boolean, threatName?: string, sha256: string }>}
 */
async function scanFileBuffer(buffer, filename, mimetype = '') {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        return { isInfected: false, sha256: '' };
    }

    const sha256 = getFileSha256(buffer);

    // 1. Signature Inspection: EICAR Standard Antivirus Test
    const fileContentString = buffer.toString('latin1');
    if (fileContentString.includes(EICAR_SIGNATURE)) {
        return {
            isInfected: true,
            threatName: 'EICAR-Test-Signature (Standard Antivirus Test File)',
            sha256
        };
    }

    // 2. WebShell / Malicious Script Payload Injection Inspection
    // Non-script files (images, pdfs, zips, docs) containing embedded executable script headers
    const isScript = /\.(js|html|css|json|txt|md)$/i.test(filename);
    if (!isScript) {
        for (const pattern of MALICIOUS_PATTERNS) {
            if (pattern.test(fileContentString)) {
                return {
                    isInfected: true,
                    threatName: 'Malicious-Payload / WebShell Signature Detected',
                    sha256
                };
            }
        }
    }

    // 3. VirusTotal Cloud API Hash Lookup (if API key is configured)
    const vtApiKey = process.env.VIRUSTOTAL_API_KEY;
    if (vtApiKey && vtApiKey.trim() !== '') {
        try {
            const vtResponse = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
                headers: { 'x-apikey': vtApiKey.trim() }
            });

            if (vtResponse.ok) {
                const vtData = await vtResponse.json();
                const stats = vtData?.data?.attributes?.last_analysis_stats;
                if (stats && stats.malicious > 0) {
                    return {
                        isInfected: true,
                        threatName: `VirusTotal: Detected malicious by ${stats.malicious} security vendors`,
                        sha256
                    };
                }
            }
        } catch (vtErr) {
            console.warn('[VirusScanner] VirusTotal API lookup skipped/error:', vtErr.message);
        }
    }

    // Clean file
    return {
        isInfected: false,
        sha256
    };
}

module.exports = {
    scanFileBuffer,
    getFileSha256,
    EICAR_SIGNATURE
};
