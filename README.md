# StudyMate — self-hosted student planner

StudyMate keeps a student's academic life in one place: **assignments, a weekly class timetable, notes, exams, a server-timed focus/study timer, a calendar, in-app reminders and a dashboard**. You run it on a server you control; the data lives in your own PostgreSQL database. No Firebase, Supabase or other managed service is required.

## Contents
1. [How it is built](#1-how-it-is-built) · 2. [Differences from the original brief](#2-differences-from-the-original-brief) · 3. [Requirements](#3-requirements) · 4. [Run it on your computer](#4-run-it-on-your-computer-development) · 5. [Run the tests](#5-run-the-tests) · 6. [Deploy on Ubuntu](#6-deploy-on-your-own-ubuntu-server) · 7. [Backups and restore](#7-backups-and-restore) · 8. [Updating and rolling back](#8-updating-and-rolling-back) · 9. [Password resets without email](#9-password-resets-without-email) · 10. [Data retention](#10-data-retention-and-account-deletion) · 11. [Troubleshooting](#11-troubleshooting) · 12. [Known limitations and unverified steps](#12-known-limitations-and-unverified-steps)

Also see: [SECURITY.md](SECURITY.md) · [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) · [docs/openapi.yaml](docs/openapi.yaml) (API reference).

---

## 1. How it is built

```
studymate/
├─ client/                  Browser app: plain HTML, CSS and ES-module JavaScript (no build step)
│  ├─ index.html, css/, assets/
│  └─ js/                   api.js (fetch + CSRF), router.js, ui.js, dom.js (safe DOM builder),
│                           forms.js, calendar-view.js, app.js, pages/*.js (one file per screen)
├─ server/
│  ├─ src/
│  │  ├─ config/            env.js — validates configuration, refuses unsafe production settings
│  │  ├─ middleware/        session, csrf, rateLimit, validate, error (central error handler)
│  │  ├─ routes/            HTTP layer: URL → validation → service call
│  │  ├─ services/          business logic + ALL SQL (every query is scoped by the signed-in user's id)
│  │  ├─ validators/        zod schemas for bodies, queries and params
│  │  └─ utils/             db (pg pool + transactions), crypto (argon2id), mailer, sql helpers
│  ├─ migrations/           001_initial.up.sql / .down.sql
│  ├─ scripts/              migrate.js, seed.js (dev only), reset-link.js (admin)
│  └─ tests/                automated tests (node:test)
├─ deploy/                  nginx/ templates, scripts/ (backup, restore, restore-test, monitor, certs, update, firewall, preflight)
├─ docs/                    openapi.yaml, PRODUCTION_CHECKLIST.md
├─ Dockerfile · compose.yaml · .env.example · .env.test.example
└─ README.md · SECURITY.md
```

**Request flow:** browser → (Nginx in production) → Express `/api/v1` → middleware (origin/content-type check → rate limit → load session → CSRF token) → route (zod validation) → service (SQL) → PostgreSQL.

**Key design choices**
- **Identity comes only from the session cookie.** The browser never says "I am user X"; every query includes `user_id = <session user>`. Another user's record looks like "not found" (404).
- **Study time is recorded by the server**, from its own clock, in one atomic SQL statement per start/pause/resume/complete. Closing the browser tab never loses or invents time; a forgotten timer is capped at 12 hours.
- **User text is never treated as HTML.** The client builds the DOM with a helper that only creates text nodes; there is no `innerHTML` anywhere (a test enforces this). A strict Content-Security-Policy backs it up.
- **Time zones:** timestamps are stored as UTC (`timestamptz`); "today", "this week", the timetable and reminders are computed by PostgreSQL in each user's chosen time zone.

## 2. Differences from the original brief

Please read these; they are deliberate and honest rather than hidden.

| Brief | What was built | Why |
|---|---|---|
| Prisma ORM + Prisma migrations | **`pg` (node-postgres) + hand-written SQL migrations** with a small runner (`up`, `down`, `status`) | Prisma could not download its engine in the build environment, so nothing Prisma-based could be run or tested. This choice was made with you (option B). |
| `controllers/` folder | Routes call services directly (no separate controllers) | Controllers would have been empty pass-throughs. |
| `client/pages/` | Screens live in `client/js/pages/` | Same idea; keeps the modules together. |
| Optional email verification | **Not implemented** | Marked optional; requires an email service. Password-reset email *is* implemented (needs SMTP). |
| (added later) Privacy/Terms/Cookie/Refund pages, consent, deletion tools | Added; see section 10a and `docs/COMPLIANCE.md` | Legal-compliance request. |
| Docker Compose deployment | Provided and statically validated, **not run** here | The build environment had no Docker daemon. See [section 12](#12-known-limitations-and-unverified-steps). |

## 3. Requirements

| For | You need |
|---|---|
| Development (Windows, macOS or Linux) | **Node.js 22.22 or newer** (the app itself ran on Node 20 in a user test, but the frontend test suite's `jsdom` dependency needs 22.22+; `npm run test:api` runs the other suites on Node 20), **PostgreSQL 14+** (16 recommended), Git |
| Production | An **Ubuntu Server LTS** machine you control, a **domain name** pointing at it (for HTTPS), **Docker Engine + Docker Compose plugin** |

## 4. Run it on your computer (development)

Commands marked **[any OS]** work in PowerShell, Terminal or bash. Commands marked **[Linux]** are for Ubuntu/Debian.

**Step 1 — install dependencies** **[any OS]**
```bash
npm install            # downloads the JavaScript packages listed in package.json
```

**Step 2 — create a database and a database user.** Open a PostgreSQL prompt (**[Linux]** `sudo -u postgres psql`; Windows: "SQL Shell (psql)" from the Start menu) and run:
```sql
CREATE ROLE studymate LOGIN PASSWORD 'choose-a-dev-password' CREATEDB;
CREATE DATABASE studymate_dev OWNER studymate;
CREATE DATABASE studymate_test OWNER studymate;   -- used only by the automated tests
\q
```

**Step 3 — configure.** Create a file named `.env` in the project folder (it is git-ignored) **[any OS]**:
```ini
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://studymate:choose-a-dev-password@127.0.0.1:5432/studymate_dev
SESSION_SECRET=any-long-random-string-of-at-least-32-characters
DEV_LOG_RESET_LINKS=true
```

**Step 4 — create the tables** **[any OS]**
```bash
npm run migrate        # applies server/migrations/*.up.sql; safe to repeat
npm run migrate:status # shows applied/pending
```

**Step 5 (optional) — load sample data** **[any OS]** — creates `demo@studymate.test` / `demo-password-123`, clearly labelled "sample". The script **refuses to run when `NODE_ENV=production`**.
```bash
npm run seed
```

**Step 6 — start the app** **[any OS]**
```bash
npm run dev            # restarts automatically when you edit server files
```
Open **http://localhost:3000**. Register a new account, or sign in with the sample user.

**Undo the last migration** (destroys data in the affected tables — back up first): `npm run migrate:down`.

## 5. Run the tests

```bash
cp .env.test.example .env.test      # Windows PowerShell: Copy-Item .env.test.example .env.test
# edit DATABASE_URL in .env.test to point at studymate_test (a throwaway database!)
npm test
```
`npm test` first applies migrations to the test database, then runs every test file **one at a time** (they share one database, so running them in parallel causes `deadlock detected` errors — never remove `--test-concurrency=1`). On Node 20 use `npm run test:api` (everything except the jsdom frontend suite). **The tests delete all users in the test database — never point `.env.test` at real data.**

What is covered (all run against a real PostgreSQL database):
- **Authentication:** registration, login, generic invalid-credential errors, logout and server-side session invalidation, expired sessions, password change (signs out other devices), password reset (expiry, single use, revokes sessions, no fake success when email is unconfigured), rate limits on login/register/forgot-password.
- **Every resource** (assignments, timetable incl. conflict warnings, notes incl. autosave conflict detection, exams, study sessions, calendar, notifications, dashboard, settings/export/account deletion): CRUD, validation, filtering/sorting/pagination.
- **Study timer:** start/pause/resume/complete using server timestamps, one active session per user, 12-hour cap.
- **Security:** every private route returns 401 when signed out; **User B cannot read, change, complete, link to or delete User A's records** (404 each time); owner IDs sent by the browser are rejected; CSRF, cross-origin and form-post attacks are blocked; SQL-injection strings are inert; no hashes/tokens in responses; no passwords/cookies/emails in logs; database outage returns 503, not a crash.
- **Frontend:** the real client code runs in a simulated browser (jsdom) against the real server: sign-up, every page renders, creating an assignment through the dialog, hostile content shown as inert text, note autosave, running a focus session, sign-out, and static checks (no `innerHTML`, no inline scripts/styles, no external URLs).
- **API documentation:** a test fails if `docs/openapi.yaml` and the real routes ever disagree.

**Not covered:** real-browser rendering/layout/responsive behaviour and dialog/keyboard behaviour (jsdom cannot exercise these — test manually on a phone and a desktop browser), screen-reader testing, load testing, and the Docker/Nginx/Let's Encrypt path (see section 12).

## 6. Deploy on your own Ubuntu server

> Everything in this section is run **on the server** (Linux) unless stated. Replace `studymate.example.com` with your domain. **Nothing here has been run against a real server by the author** — see section 12 — so follow the verification steps.

### 6.1 Prepare the server
1. **Create a server** (any VPS or a machine at home) with Ubuntu Server LTS and a public IP. Create a non-root user with sudo.
2. **DNS:** create an `A` record `studymate.example.com → your server IP` at your domain registrar. Wait until `dig +short studymate.example.com` shows the IP.
3. **Harden SSH** (prevents the most common attacks). On your own computer, make an SSH key (`ssh-keygen -t ed25519`) and install it (`ssh-copy-id you@server`). **Test that key login works in a second terminal before continuing**, then on the server edit `/etc/ssh/sshd_config.d/99-hardening.conf`:
   ```
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   MaxAuthTries 3
   ```
   Apply with `sudo sshd -t && sudo systemctl reload ssh`. Keep your current session open until a new login succeeds.
4. **Automatic security updates and brute-force protection:**
   ```bash
   sudo apt update && sudo apt install -y unattended-upgrades fail2ban gnupg rsync git
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```
5. **Firewall** — allow only SSH, HTTP, HTTPS (the script allows SSH *before* enabling, so you can't lock yourself out):
   ```bash
   SSH_PORT=22 sudo -E deploy/scripts/ufw-setup.sh     # run after step 6.2 clones the repo
   ```
6. **Install Docker** following the official guide for Ubuntu (https://docs.docker.com/engine/install/ubuntu/), then `sudo usermod -aG docker $USER` and log out/in. Check: `docker compose version`.

### 6.2 Get the code and configure
```bash
sudo mkdir -p /opt/studymate && sudo chown $USER /opt/studymate
git clone <your-repository-url> /opt/studymate && cd /opt/studymate
cp .env.example .env && chmod 600 .env
nano .env                       # set DOMAIN, PUBLIC_ORIGIN, LETSENCRYPT_EMAIL, SESSION_SECRET, POSTGRES_PASSWORD
openssl rand -base64 48         # use output for SESSION_SECRET (remove any / + = characters if you like)
openssl rand -hex 24            # use output for POSTGRES_PASSWORD
mkdir -p secrets && openssl rand -base64 36 > secrets/backup_passphrase && chmod 600 secrets/backup_passphrase
deploy/scripts/preflight.sh     # must print PREFLIGHT PASSED
```
**Copy `secrets/backup_passphrase` into your password manager now.** Without it, your backups cannot be decrypted. Never commit `.env` or `secrets/` (both are git-ignored).

All secrets live in `.env`/`secrets/`; nothing is hard-coded. The app **refuses to start** in production with a placeholder `SESSION_SECRET` or a non-`https` `PUBLIC_ORIGIN`.

### 6.3 Try it over plain HTTP first (no domain needed)
```bash
docker compose up -d --build        # builds the image; db → migrate → app → nginx start in that order
docker compose ps                   # every service should be "running"/"healthy" (migrate shows "exited (0)")
curl -s http://localhost/api/v1/health/ready      # {"status":"ok","database":"up"}
```
No domain yet? From your own computer: `ssh -L 8080:localhost:80 you@server` then browse to http://localhost:8080 — traffic is encrypted by the SSH tunnel. **Do not use the HTTP-only mode for real users:** passwords would be sent unencrypted.

### 6.4 Turn on HTTPS (Let's Encrypt)
Ports 80 and 443 must reach the server from the internet and the DNS record must already point to it.
```bash
STAGING=1 deploy/scripts/init-letsencrypt.sh   # dry run against Let's Encrypt's test servers
deploy/scripts/init-letsencrypt.sh             # real certificate; switches Nginx to HTTPS
```
Then **verify yourself**: open `https://your-domain` (padlock, redirect from http). The script cannot prove this for you. Add automatic renewal (`crontab -e`):
```
17 3 * * * cd /opt/studymate && deploy/scripts/renew-certs.sh >> /var/log/studymate-certbot.log 2>&1
```

### 6.5 Schedule backups and monitoring
```bash
crontab -e
# daily encrypted backup at 02:30
30 2 * * * cd /opt/studymate && deploy/scripts/backup.sh >> /var/log/studymate-backup.log 2>&1
# health probe every 10 minutes (non-zero exit = problem; hook up mail/uptime tooling of your choice)
*/10 * * * * cd /opt/studymate && deploy/scripts/monitor.sh >> /var/log/studymate-monitor.log 2>&1 || true
```
`monitor.sh` checks free disk space (default alert at 85 %), that PostgreSQL answers (and reports its size), that the app reports ready, and that the newest backup is under 26 hours old. Also watch container logs: `docker compose logs --tail=100 app` (structured JSON; passwords, cookies and emails are never logged).

### 6.6 What the deployment gives you
- **Only ports 80/443 are public.** PostgreSQL is on a Docker network marked `internal` and publishes **no** port; the app container publishes none either (only Nginx reaches it).
- **The app runs as a non-root user** with a read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, and memory/CPU limits.
- **Startup order is enforced:** the database must be healthy → migrations run once → the app starts. The app also retries the database connection with back-off if it starts early, returns `503` (not a crash) if the database drops while running, and shuts down gracefully on `SIGTERM`.
- **Data persists** in the `pgdata` Docker volume across restarts and upgrades; containers restart automatically (`restart: unless-stopped`) after crashes or server reboots, as long as the Docker service starts on boot (default on Ubuntu).
- **Rate limiting twice:** Nginx (per IP) and the app (per IP, and per IP+email for sign-in).

## 7. Backups and restore

**Make a backup now:** `deploy/scripts/backup.sh` → writes `backups/studymate-<time>.dump.gpg` (PostgreSQL custom-format dump, AES-256 encrypted with your passphrase file, plus a `.sha256` checksum). It immediately re-reads the archive to check it is decryptable and readable, prunes backups older than `BACKUP_KEEP_DAYS` (14), and, if `BACKUP_REMOTE` is set (e.g. `backupuser@other-host:/srv/studymate/`), copies it off the server with rsync. **A backup that only exists on the same disk disappears with that disk — set `BACKUP_REMOTE`.**

**A backup is not proven until a restore has been tested.** Do this after the first backup and then regularly (e.g. monthly):
```bash
deploy/scripts/restore-test.sh            # restores the newest backup into a throwaway database,
                                          # checks tables/row counts, then deletes the throwaway DB.
```
It never touches live data. Pass a file name to test a specific backup.

**Real restore (destructive — replaces live data):**
```bash
deploy/scripts/backup.sh                  # first save the current state if it matters
deploy/scripts/restore.sh backups/studymate-<time>.dump.gpg   # asks you to type the database name; stops app+nginx, restores, restarts
```
Rebuilding on a new server: install Docker, clone, restore `.env` and `secrets/backup_passphrase` from your password manager, `docker compose up -d db`, copy a backup file over, run `restore.sh`, then `docker compose up -d`.

*Verified by the author:* the backup, integrity check, restore test, a full wipe-and-restore recovery, and rejection of a corrupted file and of a wrong passphrase were all exercised against a real PostgreSQL 16 database using the scripts' `STUDYMATE_DB_MODE=local` mode. The Docker code path (`docker compose exec`) was **not** run.

## 8. Updating and rolling back

```bash
cd /opt/studymate && deploy/scripts/update.sh
```
It refuses to run with uncommitted local changes, takes a backup, pulls the new code, rebuilds, restarts (the one-shot `migrate` service applies new migrations first), and waits up to two minutes for the app to report healthy.

**If the upgrade fails:** the script prints the exact rollback commands. In short: `git checkout <previous-commit> && docker compose build && docker compose up -d`. If the new version changed the database in a way the old code cannot use, also restore the backup the script just made (`deploy/scripts/restore.sh <that file>`). `npm run migrate:down` (development) / `docker compose run --rm migrate node server/scripts/migrate.js down` reverses the most recent migration but **drops data in the tables it removes** — prefer restoring a backup.

Each migration is applied in a transaction, so a failing migration leaves the database unchanged.

## 9. Password resets without email

Emailed resets need an SMTP server: set `SMTP_URL` (e.g. `smtps://user:pass@smtp.example.com:465`) and `MAIL_FROM` in `.env`.

**Without SMTP the app says so honestly** — it never claims an email was sent. The "forgot password" page explains that an administrator must help, and the administrator generates a one-hour, single-use link:
```bash
docker compose run --rm app node server/scripts/reset-link.js student@example.com   # production
npm run reset-link -- student@example.com                                            # development
```
Send the link to the student over a channel you trust. In development only, setting `DEV_LOG_RESET_LINKS=true` prints reset links to the server log (this setting is ignored in production).

## 10. Data retention and account deletion

- **Deleting an account** (Settings → Delete account; requires password and typing `DELETE`) immediately and permanently removes the user and **all** their assignments, classes, notes, exams, study sessions, notifications, sessions and reset tokens from the live database in one transaction.
- **Backups are not edited.** A deleted account's data remains inside encrypted backups until they are pruned (`BACKUP_KEEP_DAYS`, default 14 days). If you ever restore a backup, re-apply deletions requested since it was taken.
- Expired sessions and old reset tokens are purged hourly; dismissed notifications are removed after 30 days.
- **Export:** Settings → Download my data gives a JSON file of the user's profile, content and consent record. It deliberately leaves out the password hash, sign-in tokens and reset tokens.
- **Reset progress** (Settings → Danger Zone) deletes completed assignments, completed/cancelled study sessions and notifications, and keeps everything else.
- **Deletion requests from people who cannot sign in:** verify who they are, then run `docker compose run --rm app node server/scripts/delete-user.js person@example.com` (dry run) and add `--yes` to delete.
- Logs do not contain passwords, cookies, CSRF tokens, search text or email addresses.

## 10a. Legal pages and compliance

StudyMate ships a **Privacy Policy, Terms of Service, Cookie Policy and Refund Policy** (footer links; `#/privacy`, `#/terms`, `#/cookies`, `#/refunds`), a cookie notice, and consent recorded at sign-up. They are **templates that describe what this software actually does. They are not legal advice and they do not make you compliant by themselves.** Before opening StudyMate to other people:
1. Fill in `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` (and `OPERATOR_PROCESSORS` if you use outside providers). The policies display a warning until you do, and `preflight.sh` fails.
2. **If you operate in Ghana, register as a data controller with the Data Protection Commission before processing other people's data.** Processing without registration is an offence under the Data Protection Act, 2012 (Act 843). Registration is valid for two years.
3. Decide who may use your installation. Sign-up has no age gate; the app does not verify ages or provide parental-consent features. Get legal advice before making it available to children.
4. Have the policies reviewed by a lawyer in your jurisdiction.
5. Read **[docs/COMPLIANCE.md](docs/COMPLIANCE.md)**: an item-by-item audit (what was done, what was found, what only you can do) and **[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)** (licence audit).

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Invalid configuration: …` at start | `.env` value missing or unsafe (placeholder secret, `PUBLIC_ORIGIN` not https in production). Run `deploy/scripts/preflight.sh`. |
| `connect ECONNREFUSED 127.0.0.1:5432` (development) | PostgreSQL is not running or `DATABASE_URL` is wrong. |
| `docker compose up` stops with "required variable … is missing" | A required value is missing in `.env`. |
| `migrate` service exited non-zero | `docker compose logs migrate` — the message names the failing migration; the database was not changed. |
| Site works on http but not https | Certificate not issued yet (`init-letsencrypt.sh` output), DNS not pointing at the server, or port 443 blocked by a cloud firewall. |
| Sign-in works but you are immediately signed out | Behind a proxy without `TRUST_PROXY=1`, or visiting over plain http in production (cookies are `Secure`). |
| "Too many attempts" | Rate limit hit; wait 15 minutes (login) or an hour (register / forgot). |
| 403 "Missing or invalid CSRF token" from a custom script | Send `X-CSRF-Token` (from `/api/v1/auth/session`) and `Content-Type: application/json`. |
| Everything returns 503 | Database unreachable: `docker compose ps`, `docker compose logs db`, check disk space (`df -h`). |
| Tests fail with ECONNREFUSED | Start PostgreSQL; check `.env.test`. |
| Forgot-password says email is not configured | Expected without SMTP — see section 9. |

## 12. Known limitations and unverified steps

**Not verified by the author (the build environment had no Docker daemon, no real browser and no internet-facing host):**
- The `Dockerfile` and `compose.yaml` were **not built or run**. Compose file syntax and its security properties (private database network, no published DB port, only Nginx publishing 80/443, required secrets) were validated with `docker compose config`; the application was separately run as an unprivileged user on a read-only copy of exactly what the image contains, with production-only dependencies.
- **Nginx** configs passed `nginx -t` (HTTP mode and HTTPS mode, on nginx 1.24), but were not run against live traffic.
- **Let's Encrypt/certbot, firewall (`ufw`) and SSH hardening steps were never executed.** After following them, verify HTTPS in a browser, run an external TLS check, and confirm from another machine that only ports 22/80/443 answer (`nmap your-server-ip`).
- **Real-browser behaviour** (layout on phones/desktops, dark theme appearance, `<dialog>` and keyboard navigation, screen readers) has not been tested; only jsdom smoke tests were run. Do a manual pass on at least one phone and one desktop browser.
- Backups were verified through the scripts' local (non-Docker) mode; schedule `restore-test.sh` and run it once on the real server.

**Functional limitations**
- **Reminders are in-app only.** They are generated by the server every 15 minutes and whenever a user opens StudyMate or the notification list; there are **no browser push notifications, emails or SMS**. If nobody opens the app, reminders wait in the database until the next visit.
- Email verification is not implemented; password-reset email needs SMTP (section 9).
- Sign-up has no age gate. The app does not verify ages or provide parental-consent features; operators should get legal advice before making it available to children.
- Registration is open to anyone who can reach the site and reveals whether an email is already registered (needed for a usable sign-up without email verification). For a private deployment, restrict access at the network level (VPN, Nginx basic auth or IP allow-list) — or ask for an invite-only mode to be added.
- There are no admin roles or admin UI: every account is an ordinary student account and can only see its own data. User management is done with the scripts and SQL.
- Single-server design (one app container, one PostgreSQL). No high availability, and no automatic off-server backups unless you set `BACKUP_REMOTE`.
- Notes are plain text (no rich text/Markdown rendering) by design, so user content can never become markup.
- A forgotten study timer records at most 12 hours.
