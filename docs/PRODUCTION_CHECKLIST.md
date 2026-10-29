# Production deployment checklist

Tick each item **after you have personally verified it**. Items the author could not verify are marked ⚠.

## Before going live
- [ ] Domain `A` record points to the server (`dig +short your-domain`)
- [ ] Non-root sudo user; SSH key login works; password and root SSH login disabled (README 6.1)
- [ ] `unattended-upgrades` and `fail2ban` installed
- [ ] `.env` created from `.env.example`, mode 600, **no `CHANGE_ME`/example values left**; `deploy/scripts/preflight.sh` prints `PREFLIGHT PASSED`
- [ ] `secrets/backup_passphrase` created (mode 600) **and copied to a password manager**
- [ ] `docker compose up -d --build` → `docker compose ps` all healthy; `migrate` exited 0 ⚠
- [ ] `curl -s http://localhost/api/v1/health/ready` → `{"status":"ok","database":"up"}` ⚠
- [ ] HTTPS issued with `init-letsencrypt.sh`; browser shows padlock; http redirects to https ⚠
- [ ] External TLS test (e.g. SSL Labs) shows no serious issues ⚠
- [ ] Firewall enabled (`ufw status`); from another machine, `nmap` shows only 22, 80, 443 ⚠
- [ ] PostgreSQL port 5432 is **not** reachable from outside (nmap) and `docker compose ps` shows no published db port ⚠
- [ ] Register a test account in the browser; add an assignment; sign out and in; reload — data persists ⚠
- [ ] `docker compose restart` and a full server reboot — site returns without manual steps, data intact ⚠
- [ ] Manual check on a phone and a desktop browser, light and dark theme, keyboard-only navigation ⚠
- [ ] Decide email: configure `SMTP_URL` **or** agree who generates reset links (`reset-link.js`)
- [ ] Decide sign-up policy: open, or restricted at the network level (VPN / allow-list / basic auth)
- [ ] Delete any test accounts; confirm **no sample/seed user exists** (`select email from users where is_seed_user;` must return nothing)

## Legal and privacy (see docs/COMPLIANCE.md)
- [ ] `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` filled in; the Privacy Policy page shows them and no red warning
- [ ] **Registered with the Data Protection Commission (Ghana) as a data controller** — or confirmed with a lawyer that you are exempt
- [ ] Privacy Policy, Terms, Cookie and Refund pages read through and reviewed by a lawyer ⚠
- [ ] Decide who may use the installation; sign-up has no age gate, and the app does not verify ages or collect parental consent
- [ ] Any outside provider that touches user data (hosting, email) is listed in `OPERATOR_PROCESSORS`
- [ ] You know how you will handle a deletion request from someone who cannot sign in (`delete-user.js`) and a data breach (who you notify, how)

## Backups and monitoring
- [ ] Backup cron installed; first `backup.sh` run succeeded ⚠
- [ ] `BACKUP_REMOTE` set and the off-server copy confirmed present
- [ ] **`restore-test.sh` passed on the server** (a backup is unproven until restored) ⚠
- [ ] `monitor.sh` cron installed; alert path tested by stopping the app briefly
- [ ] Certificate renewal cron installed; `renew-certs.sh` dry-run works ⚠
- [ ] Disk-space alert threshold chosen (`DISK_WARN_PERCENT`, default 85)

## Ongoing
- [ ] Monthly: restore test; review `docker compose logs --tail=200 app`; check disk and DB size (`monitor.sh`)
- [ ] Before each upgrade: `deploy/scripts/update.sh` (takes a backup first); `npm audit --omit=dev`
- [ ] Keep OS and Docker images patched; rebuild images with `--pull` periodically
- [ ] Review who has SSH access; rotate secrets if anyone leaves
- [ ] Re-apply account deletions after any backup restore
