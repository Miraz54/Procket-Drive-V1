// lib/mailer.js — Nodemailer setup for sending OTP emails
const nodemailer = require('nodemailer');

// Create reusable transporter (Gmail SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

/**
 * Send a 6-digit verification code to the user's email
 * @param {string} email - Recipient email address
 * @param {string} code  - 6-digit verification code
 */
async function sendVerificationCode(email, code) {
    const mailOptions = {
        from: `"Pocket Drive" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `${code} — Your Pocket Drive verification code`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0b0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:20px;border:1px solid rgba(108,99,255,0.3);overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c63ff,#a78bfa);padding:32px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
                🚀 Pocket Drive
              </div>
              <div style="font-size:14px;color:rgba(255,255,255,0.8);margin-top:6px;">
                Password Reset Verification
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="color:#f1f5ff;font-size:16px;margin:0 0 8px;font-weight:600;">
                Hello! 👋
              </p>
              <p style="color:#7f8eab;font-size:14px;line-height:1.6;margin:0 0 28px;">
                We received a request to reset your Pocket Drive password. Use the verification code below to proceed. This code is valid for <strong style="color:#a78bfa;">5 minutes</strong>.
              </p>
              <!-- OTP Code -->
              <div style="text-align:center;margin:0 0 28px;">
                <div style="display:inline-block;background:rgba(108,99,255,0.12);border:2px solid rgba(108,99,255,0.4);border-radius:16px;padding:20px 40px;">
                  <div style="font-size:36px;font-weight:900;letter-spacing:12px;color:#a78bfa;font-family:'Courier New',monospace;">
                    ${code}
                  </div>
                </div>
              </div>
              <p style="color:#7f8eab;font-size:13px;line-height:1.5;margin:0 0 6px;">
                If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="color:#3e4d6b;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} Pocket Drive — Secure Cloud Storage
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `
    };

    await transporter.sendMail(mailOptions);
}

module.exports = { sendVerificationCode };
