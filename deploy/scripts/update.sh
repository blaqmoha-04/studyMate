#!/usr/bin/env bash
# Safe upgrade: backup -> pull -> build -> migrate+restart -> health check. Prints rollback steps on failure.
. "$(dirname "$0")/lib.sh"
[ "$MODE" = docker ] || die "Docker mode only"
prev="$(git rev-parse --short HEAD)"; log "Current version: $prev"
git diff --quiet && git diff --cached --quiet || die "You have local uncommitted changes; commit or stash them first"
log "1/5 Taking a backup first…"; "$ROOT/deploy/scripts/backup.sh"
log "2/5 Pulling the new version…"; git pull --ff-only
new="$(git rev-parse --short HEAD)"; [ "$prev" != "$new" ] || log "Already up to date ($new); rebuilding anyway."
log "3/5 Building…"; docker compose build
log "4/5 Applying migrations and restarting (the 'migrate' service runs first)…"; docker compose up -d
log "5/5 Waiting for the app to become healthy…"
for i in $(seq 1 40); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then log "Healthy. Upgraded $prev -> $new."; exit 0; fi
  sleep 3
done
cat >&2 <<MSG
The app did not become healthy within 2 minutes. To roll back:
  git checkout $prev && docker compose build && docker compose up -d
If the new version applied a migration that the old code can't use, also restore the pre-upgrade backup:
  deploy/scripts/restore.sh <the backup just taken in $BACKUP_DIR>
Logs:  docker compose logs --tail=100 app migrate
MSG
exit 1
