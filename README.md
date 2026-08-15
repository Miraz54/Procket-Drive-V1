# 🚀 Pocket Drive

Pocket Drive is a secure, cloud-based storage management web application powered by **Node.js, Express, Supabase (PostgreSQL & Storage)**, and deployed on **Vercel Serverless**.

---

## ✨ Features
- **Stateless Authentication:** Secure JWT-based auth stored in HttpOnly cookies.
- **Robust Storage:** Supabase S3-compatible Object Storage with RLS policies.
- **Collaborative Folders:** Role-based permissions (`Viewer` vs `Editor`), share links, password-protected public access.
- **Multi-Tier Email System:** Nodemailer (Gmail SMTP) primary with Resend API failover.
- **Cloud Security:** Tiered rate limiting (`express-rate-limit`), origin-based CORS protection, file type filtering, and size restrictions.

---

## 📄 Technical Architecture & Proposal
For the complete, updated technical proposal addressing all architecture decisions, see:
👉 [PROJECT_PROPOSAL.md](file:///d:/website/Github%20Shohag/Blog/projects/Procket-Drive-V1/PROJECT_PROPOSAL.md)

---

## 🛠️ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables (.env)
```env
PORT=3000
NODE_ENV=development
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
JWT_SECRET=your-jwt-secret
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password
RESEND_API_KEY=your-resend-api-key
MAX_FILE_SIZE_MB=50
```

### 3. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.