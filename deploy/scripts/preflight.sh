#!/usr/bin/env bash
# Checks .env before you start or upgrade the production stack. Exit 1 if anything is unsafe.
. "$(dirname "$0")/lib.sh"
bad=0; fail() { echo "FAIL: $*"; bad=1; }; pass() { echo "ok:   $*"; }
[ -f .env ] || die ".env not found. Run: cp .env.example .env  and edit it."
perm="$(stat -c %a .env)"; case "$perm" in 600|400) pass ".env permissions $perm";; *) fail ".env permissions are $perm (run: chmod 600 .env)";; esac
for k in DOMAIN PUBLIC_ORIGIN LETSENCRYPT_EMAIL SESSION_SECRET POSTGRES_PASSWORD; do
  v="$(env_get $k)"
  if [ -z "$v" ]; then fail "$k is empty"; elif printf '%s' "$v" | grep -qiE 'change_?me|example\.(com|org)|you@example'; then fail "$k still has a placeholder value"; else pass "$k is set"; fi
done
sec="$(env_get SESSION_SECRET)"; [ "${#sec}" -ge 32 ] && pass "SESSION_SECRET length ${#sec}" || fail "SESSION_SECRET must be at least 32 characters"
for k in OPERATOR_NAME OPERATOR_EMAIL OPERATOR_ADDRESS; do [ -n "$(env_get $k)" ] && pass "$k is set" || fail "$k is empty — the Privacy Policy and Terms must name who is responsible for users' data"; done
case "$(env_get OPERATOR_EMAIL)" in *@*.*) ;; '') ;; *) fail "OPERATOR_EMAIL does not look like an email address";; esac
case "$(env_get MIN_AGE 18)" in ''|*[!0-9]*) fail "MIN_AGE must be a number";; *) [ "$(env_get MIN_AGE 18)" -ge 18 ] && pass "MIN_AGE is $(env_get MIN_AGE 18)" || echo "warn: MIN_AGE is below 18 — make sure you have taken advice on children's data (see docs/COMPLIANCE.md)";; esac
case "$(env_get PUBLIC_ORIGIN)" in https://*) pass "PUBLIC_ORIGIN uses https";; *) fail "PUBLIC_ORIGIN must start with https://";; esac
[ "$(env_get NODE_ENV production)" = production ] && pass "NODE_ENV=production" || fail "NODE_ENV must be production"
git check-ignore -q .env && pass ".env is git-ignored" || fail ".env is NOT git-ignored"
[ -s "$PASSFILE" ] && pass "backup passphrase file exists" || fail "backup passphrase file missing ($PASSFILE)"
[ -n "$REMOTE" ] && pass "off-server backup target configured" || echo "warn: BACKUP_REMOTE not set (backups stay on this server)"
[ -n "$(env_get SMTP_URL)" ] && pass "SMTP configured (emailed password resets work)" || echo "warn: SMTP_URL empty — admins must generate reset links with 'npm run reset-link'"
[ "$bad" = 0 ] && echo "PREFLIGHT PASSED" || { echo "PREFLIGHT FAILED"; exit 1; }
