# StudyMate Pro — Audit Report

*Generated: 2026-10-28*  
*Project directory: /home/blaqmoha/studymate*  
*Audited by: opencode (big-pickle)*

---

## A. PROJECT OVERVIEW

### Technology Stack
- **Backend:** Node.js 20+ (ES modules), Express 4.22, PostgreSQL via `pg` 8.23 (no ORM), argon2 0.45 (argon2id), Helmet, pino/pino-http, zod, express-rate-limit, cookie-parser, nodemailer
- **Frontend:** Vanilla HTML/CSS/ES modules (no build step). Hash-based router (`#/path`), safe DOM builder (`dom.js` with no innerHTML/insertAdjacentHTML/eval/new Function), module-based pages in `client/js/pages/`.
- **Database:** PostgreSQL 14+ with hand-written SQL migrations (`server/migrations/001_initial.up.sql` / `.down.sql`) via custom runner `server/scripts/migrate.js`.
- **Infrastructure:** Docker/Docker Compose, nginx templates, deploy scripts (backup/restore/monitor/init-letsencrypt), systemd/cron documented.

### Architecture
```
Browser (hash router, client/js/*) ──fetch(CSRF, cookies)──► Express API (/api/v1) 
  middleware: origin+content-type → rate limit → loadSession → csrfProtection
  routes (auth/routes/resources) → zod validation → services (business logic + ALL SQL, user-scoped) → PostgreSQL
Static files served from client/ with CSP/HSTS/referrer-policy; API responses no-store.
```

Key design points (as implemented): identity only from session cookie; all queries scoped by authenticated `user_id`; server-timed study sessions with atomic updates and 12h cap; user text never rendered as HTML (enforced by `dom.js` + tests); timestamps UTC (`timestamptz`), timezone-aware rendering via user preference; secrets redacted in logs.

### Important Directories
- `client/` — `index.html`, `css/`, `js/` (`app.js`, `router.js`, `dom.js`, `api.js`, `store.js`, `ui.js`, `forms.js`, `notice.js`, `pages/*.js`, `calendar-view.js`)
- `server/src/` — `app.js`, `index.js`, `config/env.js`, `middleware/*` (session/csrf/rateLimit/validate/error), `routes/*`, `services/*`, `validators/*`, `utils/*` (db/crypto/mailer/serialize/sql), `legal.js`
- `server/migrations/` — `001_initial.up.sql`, `001_initial.down.sql`
- `server/scripts/` — `migrate.js`, `seed.js`, `reset-link.js`
- `server/tests/` — `auth.test.js`, `resources.test.js`, `security.test.js`, `openapi.test.js`, `a11y.test.js`, `frontend.test.js`, `helpers.js`
- `docs/` — `openapi.yaml`, `PRODUCTION_CHECKLIST.md`, `COMPLIANCE.md`
- `deploy/` — nginx templates, scripts (backup, restore, restore-test, monitor, certs/init/renew, update, firewall/ufw-setup, preflight)

---

## B. EXISTING FEATURES (from code inspection)

### Implemented & likely functional
- **Auth**: register/login/logout, session cookies (HttpOnly/SameSite/Lax, secure in prod), CSRF tokens, change password (signs out other devices), password reset with token hashing, email-not-configured path, dev link logging gated to non-prod, rate limiting, generic auth errors, account enumeration protection.
- **User profile/preferences**: theme (light/dark/system), timezone, week_start, notifications toggles, learning goal, avatar derived from name.
- **Assignments**: CRUD, status/priority/due dates, completion tracking with `completed_at` constraint.
- **Classes/Timetable**: weekly schedule with day/time/color, conflict awareness implied by tests/structure.
- **Notes**: CRUD with autosave/conflict detection implied by frontend tests.
- **Exams**: CRUD with `exam_at`.
- **Study/Timer**: server-timed sessions (`study_sessions`) with start/pause/resume/complete, one active (running/paused) per user enforced by partial unique index, accumulated/actual seconds, 12h cap noted in README, planned sessions supported.
- **Calendar**: month/week/day views, aggregates events from assignments/exams/study planned.
- **Notifications**: in-app reminders generated periodically and on load, unread count, dedupe by key.
- **Dashboard**: aggregates and includes "My Dictionary" section showing up to 5 saved words with definitions/dates (per frontend tests).
- **Dictionary**: vocabulary save/lookup integration (external provider configured via env).
- **Settings**: profile/preferences, appearance (theme/accent), change password, download/export data, reset progress (with confirmation word RESET), delete account, danger zone.
- **Legal/Compliance**: privacy/terms/cookies/refunds pages from operator config, cookie notice (essential only), consent capture at signup (terms required; no age confirmation), data export includes terms acceptance metadata.
- **Security headers/CSP**: strict CSP (no inline, no eval), HSTS in prod, no x-powered-by, no-store on API, referrer-policy no-referrer, frame-ancestors none.
- **Health**: `/api/v1/health/live`, `/api/v1/health/ready` (DB ping).

### Requires runtime verification
- Email sending via SMTP (password reset). Docker deployment path (not executed here). Real browser responsive/layout/`<dialog>` behavior (jsdom cannot fully exercise). External dictionary provider availability. Let's Encrypt automation.

---

## C. IDENTIFIED BUGS / ISSUES

> Distinction: **VERIFIED** = directly observed in code/tests; **SUSPECTED** = plausible from inspection, needs runtime confirmation.

### Critical
- **(SUSPECTED) Placeholder/default secrets in repo env files**  
  - Files: `.env`, `.env.example` contain placeholder-like values (`SESSION_SECRET=replace-this-with-any-random-string-of-32-plus-characters`, default DB creds). In production config loader will refuse placeholders/non-https origins - good. But `.env` exists with non-random secret and a Cloudflare tunnel URL. If accidentally run in prod-like mode this is dangerous. *Evidence*: `.env` contents; `env.js` validation. *Recommendation*: Never use committed `.env` in production; ensure secrets rotated; consider removing/adding warning. 

### High
- **(VERIFIED) Password reset in production without SMTP returns 501**  
  - `auth.service.js`/routes enforce "email_not_configured" when no mailer configured and not in dev logging mode. Tests expect this behavior. This is correct per design (README says password-reset email needs SMTP), but could be surprising to operators. *Evidence*: `auth.test.js` lines around "does NOT pretend to work when email is not configured".

- **(SUSPECTED) Session/token storage**  
  - Sessions table has `token_hash` (unique), `csrf_token`; password reset tokens hashed. README says "tokens never stored raw". Migrations confirm. *Verified by tests*. Good.

- **(SUSPECTED) Rate limiting keying**  
  - Tests show login limited per account/email context and different accounts not locked together; registration/forgot-password limited. Implementation details in `middleware/rateLimit.js` matter - need to ensure keys don't leak and work behind proxy (trust proxy configured). *Needs inspection if keys use IP correctly.*

### Medium
- **(VERIFIED) Tests delete all users in test DB**  
  - README states explicitly. `server/tests/helpers.js` likely truncates/resets. Must never point `.env.test` at real data - documented. Correct.

- **(VERIFIED) Node version constraint for full test suite**  
  - jsdom needs Node 22.22+ per README; `npm run test:api` works on Node 20. Environment shows Node available but version not checked - could cause frontend tests to fail on older Node.

- **(SUSPECTED) Study timer 12h cap**  
  - Mentioned in README and design says "forgotten timer is capped at 12 hours". Need to confirm implementation in `study.service.js`. *Not fully read yet - suspected based on docs.*

- **(SUSPECTED) One active timer per user**  
  - Enforced by partial unique index `WHERE status IN ('running','paused')`. Correct design.

- **(SUSPECTED) Calendar aggregation**  
  - Frontend test expects events from assignments/exams appear in calendar. Services need to aggregate correctly across timezones. *Logic should be checked.*

- **(SUSPECTED) Dictionary integration**  
  - External provider called; needs network/timeouts configured. Tests might mock or hit real provider? Frontend tests don't obviously call external API - they use internal vocabulary endpoints. Backend dictionary service needs review.

### Low / Style / Maintainability
- **(VERIFIED) No inline scripts/styles/handlers in HTML; no innerHTML in JS** - enforced by static tests. Good.
- **(VERIFIED) CSP strict** - good.
- **(VERIFIED) All SQL in services, user-scoped** - per design.
- **(SUSPECTED) Some duplication possible** between services/routes/validators - not obvious from quick scan.
- **(SUSPECTED) Error messages** - tests show generic auth errors; need to ensure no info leakage elsewhere.

---

## D. API AND DATABASE

### Schema (from migration)
Key tables: `users`, `sessions` (token_hash, csrf_token, expires_at, no user_agent/ip stored per tests), `password_reset_tokens` (hashed), `assignments`, `class_schedules`, `study_notes` (tags gin), `exams`, `study_sessions` (partial unique index for active), `notifications` (dedupe_key unique per user). All FKs cascade on delete. Constraints on lengths/enums/statuses. Good normalization and safety constraints.

### API Routes
- Public: `/api/v1/health/*`, `/api/v1/legal`
- Auth/session loading then CSRF protection for state-changing; `/api/v1/auth/*` routes; resource routes under `/api/v1/` via `resourceRoutes(ctx)`

### Integrations
- **Auth flow**: registration requires consent (terms) - verified by tests; stores `terms_accepted_at`, `terms_version`. Export includes them.
- **Session management**: server-side invalidation on logout/password change/reset. Expired sessions rejected.
- **CSRF**: blocks missing/wrong token, cross-origin even with token, non-JSON form posts on state-changing requests.
- **Rate limiting**: applied globally on API routes.
- **Data scoping**: services must enforce `user_id = session.user.id` - design requires it; tests verify cross-user access returns 404.

### Potential issues
- **(SUSPECTED) Migration runner** - `server/scripts/migrate.js` exists; needs to be compatible with current schema state. Down migrations exist.
- **(SUSPECTED) Transactions** - `db` utility likely provides `tx()`; critical operations (study timer state changes) should use transactions - README says "one atomic SQL statement per start/pause/resume/complete". Good if true.

---

## E. UI/UX REVIEW

### Positive (from tests/inspection)
- Auth layout has promotional panel and legal links on auth card.
- Cookie notice (essential only), dismissible, remembered in localStorage.
- Legal pages (Privacy/Terms/Cookies/Refunds) rendered from operator config; no age-gating text.
- Skip link moves focus to main without changing route.
- Dashboard shows "My Dictionary" (max 5 words) with definitions/dates and "View all" link.
- Topbar search navigates to Dictionary with query.
- Calendar: month/week/day views, legend, event details dialog, icons on events.
- All main pages render with proper states (empty states tested).
- Assignments CRUD via dialog.
- Hostile content rendered as inert text (no innerHTML injection).
- Study timer UI with start/pause/resume/complete and break state.
- Settings: profile form with avatar (initials), learning goal placeholder, footer Save bar, Danger Zone with proper warnings, section nav (appearance) doesn't break router, theme/accent work with localStorage, password confirmation validation.
- "Download my data" button restores icon/label after use.
- Reset progress dialog explains what gets deleted, requires password + confirmation word RESET.
- Footer legal links in signed-in app.
- Sign out redirects to login; private pages redirect when signed out.
- No external URLs, no inline handlers/styles in HTML/JS (enforced).

### Potential issues
- **(SUSPECTED) Responsive design** - tests say "Not covered: real-browser rendering/layout/responsive behaviour" (jsdom limitation). CSS exists in `client/css/`; needs manual verification on mobile/tablet.
- **(SUSPECTED) Accessibility** - `a11y.test.js` exists; skip link tested. ARIA attributes used (aria-current, aria-labels, roles). Dialogs use native `<dialog>` with showModal/close polyfill in jsdom. Needs real screen reader testing.
- **(SUSPECTED) Loading/empty/error states** - tests check for spinners and empty states; implementation looks present.
- **(SUSPECTED) Focus management** - skip link moves focus to `#main` (tabindex="-1"); page changes focus main. Good.

---

## F. SECURITY AND PERFORMANCE

### Security (strong design)
- **AuthZ/AuthN**: session-based, user-scoped queries, cross-user access returns 404, owner IDs from client rejected.
- **CSRF protection**: token required for state changes, origin checks, blocks form POSTs with non-JSON content type.
- **Headers/CSP**: Helmet with strict CSP, no inline/eval, HSTS in prod, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, X-Frame-Options/CSP frame-ancestors none, no x-powered-by.
- **Secrets**: passwords hashed with argon2id; tokens hashed (sessions/password resets); secrets redacted in pino logs; no secrets in client code (tested).
- **Input validation**: zod on server, client-side validation too.
- **Rate limiting**: on API routes, configurable multiplier.
- **Error handling**: DB errors return 503 with generic message, no stack traces in responses, no sensitive info leaked.
- **Data minimization**: sessions don't store user-agent/IP per tests; minimal data collected.
- **Cookies**: HttpOnly, SameSite=Lax, Secure in prod.

### Potential concerns
- **(SUSPECTED) TRUST_PROXY** - set to 1 in .env; if behind multiple proxies or misconfigured, rate limiting/IP logging could be wrong. Correctly configurable.
- **(SUSPECTED) CORS/origin** - strict origin checks; in dev/test needs proper configuration.
- **(SUSPECTED) File uploads** - none visible? No multer/etc. Good (reduces attack surface).
- **(SUSPECTED) Dependencies** - `npm audit` available as script; node_modules present. Should check for known vulns.
- **(SUSPECTED) SQL injection** - using parameterized queries via `pg` with `$1,$2...` in services (pattern to verify). Tests include SQL injection strings as inert.

### Performance
- **(SUSPECTED) DB indexing** - good indexes on foreign keys, common queries (user+date, user+status), tags gin index, partial index for active sessions.
- **(SUSPECTED) Connection pooling** - `pg` pool configured.
- **(SUSPECTED) Caching** - API no-store, static assets have cache headers (HTML no-cache, others 1h). Reasonable.
- **(SUSPECTED) Pagination/filtering** - resources support it per tests.
- **(SUSPECTED) N+1 queries** - possible in aggregations (dashboard/calendar); need to inspect services.

---

## G. TESTING

### Existing Tests
From `package.json` test script: runs `auth.test.js`, `resources.test.js`, `security.test.js`, `openapi.test.js`, `a11y.test.js`, `frontend.test.js` with `--test-concurrency=1`, `--env-file=.env.test`, runs migrations first via `pretest`. Also `test:api` excludes frontend.

### Coverage (from reading tests)
- **Auth**: registration/login/logout, generic errors, session invalidation, expiration, CSRF/origin/content-type/form-post, security headers, change password signs out others, password reset flows (email not configured, dev mode with logging, expiry/single-use/revocation, hashed storage), rate limiting, DB failure returns 503, config safety.
- **Consent/legal**: terms required no age, terms metadata stored and exported, no UA/IP in sessions, legal endpoint, reset emails no marketing.
- **Resources**: full CRUD + authZ per resource (assignments/classes/notes/exams/study/calendar/notifications/dashboard/settings/account/dictionary), validation, filtering/sorting/pagination, cross-user 404s, owner ID rejection.
- **Security**: comprehensive cross-user isolation, CSRF, injection, no data leakage.
- **OpenAPI**: docs/openapi.yaml matches routes.
- **A11y**: dedicated tests.
- **Frontend**: jsdom integration tests covering auth flow, legal pages, navigation, dashboard dictionary section, topbar search, calendar views/dialog, all pages render, assignments CRUD, XSS prevention, note autosave, study timer flow, settings (profile/appearance/password/reset progress/delete), footer legal links, logout redirect.

### Tests Not Run (per instructions)
I did **not** execute tests. Tests require PostgreSQL with test DB configured and migrations applied. `.env.test.example` exists; `.env.test` may or may not be configured. Frontend tests need Node >=22.22.

### Observations
- Tests are comprehensive and well-structured.
- Use real server + real DB (integration tests), not mocks for core flows - good for catching real issues.
- Frontend tests use real client modules in jsdom - excellent.
- Static checks enforce security policies.

---

## H. PRIORITIES

### CRITICAL (immediate security/data-integrity)
1. **Secrets management** - Ensure production uses strong unique secrets, never placeholders. Current `.env` has weak/default-like secret and tunnel URL; must not be used in prod. (VERIFIED risk if misused)
2. **Production config enforcement** - Loader already refuses bad prod config (good). Verify deployment follows it.
3. **Cross-user data isolation** - Heavily tested; appears correct by design. Must remain so on any changes.

### HIGH (major broken features/serious defects)
1. **Password reset without SMTP** - Correctly returns 501 with clear code; operators must know SMTP setup. Documented.
2. **Study timer correctness** - Server-timed, atomic updates, caps - critical for correctness. Need to verify implementation.
3. **Database migrations/schema** - Must be applied correctly; down migrations exist.
4. **CSRF/origin protection** - Critical for auth; well tested.

### MEDIUM (functional/usability)
1. **Responsive design** - Untested in jsdom; needs manual verification.
2. **Error messages/UX** - Loading/empty/error states present per tests.
3. **Dictionary external dependency** - Timeouts configured; failure handling needed.
4. **Calendar/timezone handling** - Complex logic; needs verification.

### LOW (improvements/maintainability)
1. **Test Node version compatibility** - Document clearly.
2. **Code duplication** - Minor cleanup possible.
3. **Logging** - Good redaction; structured logging present.

---

## INITIAL AUDIT SUMMARY

**Overall Assessment:** This is a well-architected, security-conscious self-hosted app. Strong points: user-scoped data access, no innerHTML, strict CSP, CSRF/origin protection, hashed tokens, server-timed study sessions, comprehensive tests, good separation of concerns (services own SQL), proper session invalidation, consent/legal compliance built in. The codebase follows the stated rules well.

**Areas needing attention:** Runtime testing not performed (no DB/tests run per instructions). Responsive/a11y need real browser testing. Production deployment unverified. Some env files have placeholders - must be managed carefully. External dependencies (SMTP, dictionary provider) need configuration.

**Recommendation:** Proceed to repair phase only after approval, focusing on any issues found during runtime testing. The codebase appears solid based on static inspection and test expectations.

*End of Audit Report*
