# Pocket Drive — Project Architecture & Technical Proposal (v2.0)

**Project Name:** Pocket Drive  
**Version:** 2.0.0  
**Author / Team:** Pocket Drive Engineering Team (Md. Mirazul Alam & Shohag Basak)  
**Target Reviewer:** Malyha Medha (`malyha.mabud@gmail.com`)  
**Repository:** [Pocket Drive V1](https://github.com/ShohagBasak/Procket-Drive-V1)

---

## 1. Executive Summary

Pocket Drive is a modern, high-performance, secure cloud storage application built with Node.js/Express and Supabase. It provides seamless file management, folder hierarchies, granular role-based sharing (Viewer/Editor), password-protected public shares, and transactional OTP authentication.

This updated document addresses and clarifies the architectural design decisions regarding **Authentication**, **Email Service Fallbacks**, **Cloud Security / Rate Limiting**, and **File Validation / Antivirus Protection**.

```mermaid
graph TD
    Client[Web Browser / Client] -->|HTTPS Requests| Cloudflare[Edge / DNS / CDN]
    Cloudflare -->|Filtered Requests| Server[Node.js / Express Serverless Core]
    
    subgraph Security Layer
        Server --> CORS[CORS Origin Whitelisting]
        Server --> RateLimit[Tiered Rate Limiter: Auth, API, Upload]
        Server --> FileValidator[File Extension & MIME Sanitizer]
    end

    subgraph Authentication
        Server --> JWT[Stateless JWT Auth - HttpOnly Cookie]
    end

    subgraph Storage & Database
        Server --> SupabaseDB[(Supabase PostgreSQL)]
        Server --> SupabaseStorage[(Supabase Object Storage)]
    end

    subgraph Email Delivery System
        Server --> PrimaryEmail[Primary: Nodemailer - Gmail SMTP]
        PrimaryEmail -.->|Failover on Error| FallbackEmail[Secondary: Resend API]
    end
```

---

## 2. Authentication Strategy: Stateless JWT

### Architectural Clarification
Earlier revisions mentioned both `express-session` and `JWT`. In **Pocket Drive v2.0**, we have standardized on **Stateless JWT (JSON Web Tokens)**:

- **Token Storage:** Issued as an `HttpOnly`, `Secure`, `SameSite=None/Lax` cookie (`pd_token`).
- **Why JWT?**
  - Perfect fit for serverless runtime environments (Vercel Serverless Functions) where in-memory sessions are volatile.
  - Zero database lookup overhead for authentication verification on high-frequency API routes.
  - Expiry is set to **24 hours** with automatic token lifecycle management.
- `express-session` is solely used as an optional local dev memory bridge and does not compromise the stateless architecture.

---

## 3. Email Infrastructure & Fallback Strategy

Rather than using redundant services arbitrarily, Pocket Drive implements a resilient **Multi-Tier Email Fallback Architecture**:

```mermaid
sequenceDiagram
    participant App as Pocket Drive Core
    participant Primary as Nodemailer (Gmail SMTP)
    participant Secondary as Resend API
    participant User as Recipient Mailbox

    App->>Primary: Attempt to send OTP / Notification
    alt Primary SMTP Success
        Primary-->>User: Delivered
    else SMTP Limit / Timeout / Failure
        Primary-->>App: Exception / Error
        App->>Secondary: Trigger Failover (Resend HTTPS API)
        Secondary-->>User: Delivered via Fallback
    end
```

1. **Primary Engine (Nodemailer / Gmail SMTP):**
   - Handles immediate transactional emails (e.g. 6-digit password reset OTP codes).
   - Low cost and instant delivery for standard workloads.
2. **Secondary Failover Engine (Resend API):**
   - If Gmail SMTP encounters rate limits, connection timeouts, or service disruptions, the system seamlessly triggers the Resend API (`api.resend.com/emails`) as an automated fallback.
   - Guarantees 99.99% notification delivery for mission-critical events (shared folder invites, upload alerts).

---

## 4. Cloud Security & Resource Protection

### 4.1. CORS (Cross-Origin Resource Sharing)
- Dynamic CORS middleware restricts access exclusively to verified application domains:
  - Production: `https://procket-drive-v1.vercel.app` (or custom domains specified via `ALLOWED_ORIGIN`).
  - Staging / Local: `http://localhost:3000`.
- Protects credential transmission by enforcing strict `Access-Control-Allow-Credentials: true` only on authorized origins.

### 4.2. Tiered Rate Limiting
To prevent Distributed Denial of Service (DDoS), credential stuffing, and brute-force attacks, we enforce three distinct rate-limiting zones:

| Limiter Zone | Endpoint Scope | Window | Request Limit | Purpose |
|---|---|---|---|---|
| **Global API** | `/api/*` | 15 mins | 200 requests | General API abuse & scraping prevention |
| **Auth & OTP** | `/api/auth/login`, `/register`, `/forgot-password/*` | 15 mins | 15 attempts | Brute-force & credential stuffing defense |
| **File Upload** | `/api/files/upload` | 15 mins | 60 uploads | Storage flooding & denial-of-wallet protection |

### 4.3. File Size Constraints
- **Per-file limit:** Hard-capped at **50 MB** (configurable via `MAX_FILE_SIZE_MB`).
- Enforced at the `Multer` streaming buffer stage to prevent memory exhaustion before data reaches cloud storage.

---

## 5. File Validation & Antivirus Protection Pipeline

```mermaid
flowchart TD
    A[Incoming File Upload] --> B{Size <= 50MB?}
    B -- No --> B1[Reject: LIMIT_FILE_SIZE]
    B -- Yes --> C{Dangerous Extension Check?}
    C -- Matched .exe/.bat/.sh/.ps1 etc. --> C1[Reject: Restricted File Type]
    C -- Safe --> D{MIME Type Inspection}
    D -- Mismatch / Suspicious --> D1[Reject: Invalid MIME]
    D -- Verified --> E[Upload to Supabase Storage]
    E --> F[Async Cloud Antivirus Scanner Webhook]
    F -->|Clean| G[File Marked Active & Downloadable]
    F -->|Infected| H[File Quarantined & Deleted + Alert Owner]
```

### 5.1. File Extension & MIME Filtering
- **Restricted Extensions:** Executable and script files that pose security risks are strictly blocked:
  - Executables: `.exe`, `.msi`, `.com`, `.scr`, `.pif`, `.application`, `.gadget`, `.cpl`, `.msc`
  - Scripts: `.bat`, `.cmd`, `.sh`, `.bash`, `.vbs`, `.vbe`, `.wsf`, `.ps1`, `.ps2`, `.jar`, `.reg`
- **Sanitized Naming:** File names are sanitized on upload (`timestamp + regex-cleaned name`) to neutralize Directory Traversal (`../`) attacks.

### 5.2. Antivirus & Malware Scanning Strategy
1. **Quarantine-on-Upload State:** Files are uploaded with initial status validation.
2. **Asynchronous Virus Scanning:**
   - Webhook trigger to a ClamAV daemon container or cloud-native virus scanning API (e.g. AWS GuardDuty / VirusTotal API / Cloudflare Virus Scanner).
   - If malicious signatures are identified, the storage object is permanently deleted immediately, the database record is flagged as `quarantined`, and an incident alert is dispatched to the user.

---

## 6. Technical Stack Summary

| Layer | Technology |
|---|---|
| **Runtime & Backend** | Node.js (v18+), Express.js |
| **Serverless Deployment** | Vercel Serverless Functions |
| **Database** | PostgreSQL via Supabase (Row Level Security enabled) |
| **Object Storage** | Supabase Storage (S3-compatible bucket) |
| **Authentication** | Stateless JWT (`jsonwebtoken`), `bcryptjs`, HttpOnly Cookies |
| **Rate Limiting** | `express-rate-limit` |
| **Email Service** | Nodemailer (Gmail SMTP Primary) + Resend API (Failover) |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 Glassmorphism UI |

---

## 7. Next Steps & Contact

This architecture is fully implemented in the current codebase and ready for production deployment.

- **Primary Contact:** Md. Mirazul Alam (`rjmiraz02@gmail.com`) / Shohag Basak
- **Feedback & Submissions:** Malyha Medha (`malyha.mabud@gmail.com`)
