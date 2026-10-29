# StudyMate security guide

This document states what StudyMate protects against, **where each control lives and which test verifies it**, what the operator must do, and — just as important — what is **not** protected. Nothing here is a guarantee: it describes the code and tests in this repository. Treat the deployment steps as unverified until you have run them (see README section 12).

## 1. Threat model (short)
Protected: a student's private records from other users of the same installation, from anyone on the internet without an account, and from common web attacks (XSS, CSRF, SQL injection, credential stuffing, session theft by script).
**Not** protected: a compromised server or administrator (they can read the database), a compromised student device, a malicious operator of the host, and denial-of-service beyond basic rate limiting.

## 2. Controls and their evidence

| Requirement | Implementation | Verified by |
|---|---|---|
| Password hashing | **Argon2id** (19 MiB, t=2, p=1) — `server/src/utils/crypto.js`; unknown-email logins still run a hash so timing doesn't reveal accounts | `auth.test.js` (hash starts `$argon2id$`, generic error) |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie; only an HMAC-SHA256 of the token (keyed by `SESSION_SECRET`) is stored; 7-day sliding expiry; deleted server-side on logout, password change (others), password reset (all), account deletion; old session removed at login (no fixation) | `auth.test.js` (logout invalidation, expiry, other-device sign-out, tokens stored hashed); cookie flags checked on a production-mode run |
| CSRF | (1) state-changing requests must be `application/json` (forces a CORS preflight which is never granted); (2) `Origin`, if present, must equal the site origin; (3) per-session `X-CSRF-Token` required for signed-in changes | `auth.test.js` (no token, wrong token, evil Origin, form-post), `security.test.js` (B's session + A's token) |
| Authorization / IDOR | Identity from the session only; every service query has `user_id = $current`; foreign IDs return 404; foreign `assignmentId`/`examId` on study sessions are rejected; schemas are `.strict()` so `userId` in a body is a 400 | `security.test.js` — **every** read/update/delete/action by User B on User A's records, lists, dashboard, calendar, export, filters |
| Authentication required | `requireAuth` on all private prefixes; unknown routes are 404 | `security.test.js` — 48 routes return 401 signed out (plus unknown routes return 404) |
| Rate limiting | App: sign-in per IP+email (8/15 min) and per IP (40/15 min), register 10/h, forgot 6/h, reset 15/h, password-sensitive 10/15 min, API 600/min. Nginx: 5 r/s on `/api/v1/auth/`, 20 r/s elsewhere | `auth.test.js` (login, forgot, register hit 429). Nginx limits: config validated only |
| Input validation | zod on bodies, queries, params; unknown fields rejected; sizes capped (`300kb` body, per-field limits); DB `CHECK` constraints as a second layer | `resources.test.js` (bad dates, enums, ranges, oversize), `auth.test.js` (malformed/oversized JSON) |
| SQL injection | Parameterised queries only; no user text is interpolated into SQL (sort/order are whitelisted enums); `LIKE` wildcards are escaped | `security.test.js` (injection strings inert, bad sort rejected, tables intact) |
| XSS | Client never parses HTML strings (no `innerHTML`; text nodes only); notes are plain text; CSP `default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'` — no inline script or style | `frontend.test.js` (hostile titles/notes/exams render as literal text, no injected nodes; static scan for unsafe APIs, inline handlers/styles, external URLs) |
| Security headers | Helmet: CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, CORP, HSTS (production); `X-Powered-By` removed; API responses `Cache-Control: no-store`; Nginx adds HSTS | `auth.test.js`; production-mode run (HSTS present) |
| CORS | Not enabled at all (same-origin app) | by design; cross-origin requests blocked by the Origin check |
| Password reset | One-time token (256-bit), stored hashed, 1-hour expiry, single use, revokes all sessions; identical response for known/unknown email; **honest 501** when SMTP is missing; dev link logging disabled in production | `auth.test.js` |
| Generic auth errors | Same message and status for wrong password and unknown email | `auth.test.js` |
| Error handling | Central handler; no stack traces, SQL, hosts or hashes in responses; DB outage → 503 | `auth.test.js` (503 without leaking host), real-process outage/recovery run |
| Logging | Request id, method, path (no query string), status; cookies and auth headers redacted; no bodies, emails, passwords or search text | `security.test.js` (log-leak test) |
| Secrets | Only in `.env` / `secrets/` (git-ignored, `chmod 600`); app refuses placeholder `SESSION_SECRET` and non-https origin in production; `preflight.sh` checks before deploy; nothing secret reaches the browser | `auth.test.js` (config refusal), `frontend.test.js` (no secrets/external hosts in client), preflight run |
| Least privilege | App container: non-root, read-only filesystem, no capabilities, `no-new-privileges`, memory/CPU/pid limits. Database on an `internal` network, no published port. Only 80/443 public | `docker compose config` assertions; app run as `nobody` on a read-only tree. **Containers themselves not run** |
| Dependency checks | `npm run audit` (production dependencies) | `npm audit` reported 0 vulnerabilities when this was written — **re-run it regularly** |
| Account deletion | Password + typed confirmation; hard delete by `ON DELETE CASCADE` in one transaction | `resources.test.js` (all tables empty for the user, other user intact) |
| Backups | AES-256 (GnuPG, authenticated), checksum, post-write readability check, restore test script | exercised in local mode: backup, restore-test, wipe-and-restore, corrupted file and wrong passphrase rejected |

## 3. Operator checklist (do these)
- [ ] Run `deploy/scripts/preflight.sh` — must pass.
- [ ] Use a long random `SESSION_SECRET` and `POSTGRES_PASSWORD`; keep `.env` mode 600; never commit it. Rotating `SESSION_SECRET` signs everyone out and invalidates outstanding reset links.
- [ ] SSH: key-only login, no root login (README 6.1); enable `unattended-upgrades` and `fail2ban`.
- [ ] Firewall: `deploy/scripts/ufw-setup.sh`; confirm from another machine that only 22/80/443 answer. Note Docker edits iptables itself; this stack publishes only 80/443.
- [ ] HTTPS working and renewing (`renew-certs.sh` cron). Check the certificate expiry date after the first renewal window.
- [ ] Off-server encrypted backups (`BACKUP_REMOTE`), the passphrase stored **separately** from the server, and a restore test (`restore-test.sh`) run at least monthly.
- [ ] `monitor.sh` scheduled; someone actually receives its failures.
- [ ] Keep the OS, Docker images (`docker compose pull && docker compose build --pull`) and npm dependencies updated; run `npm audit --omit=dev` before each release.
- [ ] If this is for a closed group, restrict who can reach the site (VPN, IP allow-list, or Nginx basic auth) because sign-up is open.

## 4. Known limitations (not protected / not done)
- **No two-factor authentication**, no CAPTCHA, no per-account lockout beyond rate limits. Strong, unique passwords are the main defence (minimum 10 characters, no breached-password check).
- **Registration reveals whether an email exists** (HTTP 409). Login and password reset do not.
- **Rate-limit counters live in the app's memory**: they reset when the app restarts and are per-instance (fine for the single-container design; a multi-instance deployment needs a shared store).
- **No encryption at rest** for the live database volume. Use full-disk encryption on the server if you need it. Database traffic stays on Docker's internal network and is not TLS-encrypted.
- **Nginx access logs contain client IP addresses** (default Nginx behaviour); the application's own logs do not. Rotate/limit retention per your privacy obligations.
- **Backups retain deleted users' data** until pruned (default 14 days). Restoring an old backup resurrects deleted accounts.
- **Email verification is not implemented**; an email address is not proven to belong to the person registering it.
- **SameSite=Lax** cookies are sent on top-level navigations from other sites; state-changing endpoints are protected by the CSRF controls above, not by SameSite alone.
- Untested here: behaviour under heavy load or targeted denial of service, real-browser CSP enforcement, penetration testing by a third party. Consider an independent review before holding sensitive data for many users.

## 5. Reporting a vulnerability
Open a private security advisory in your repository host or email the maintainer listed in your deployment. Please include steps to reproduce and do not publish details until a fix is available.
