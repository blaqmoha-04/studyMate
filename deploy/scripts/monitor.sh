#!/usr/bin/env bash
# Health probe for cron/uptime tooling. Exit code 0 = healthy, 1 = problem (output explains).
#   */10 * * * * /opt/studymate/deploy/scripts/monitor.sh || echo "StudyMate problem" | mail -s alert you@example.com
. "$(dirname "$0")/lib.sh"
DISK_WARN="${DISK_WARN_PERCENT:-85}"; problems=0
warn() { echo "PROBLEM: $*"; problems=$((problems+1)); }

# 1. Disk space (a full disk is the most common way self-hosted databases die)
for path in / "$BACKUP_DIR"; do
  [ -d "$path" ] || continue
  use="$(df -P "$path" | awk 'NR==2 {gsub("%","",$5); print $5}')"
  [ "$use" -lt "$DISK_WARN" ] && echo "ok: disk $path at ${use}%" || warn "disk $path at ${use}% (threshold ${DISK_WARN}%)"
done
# 2. Database reachable + size + connections
if v="$(db_sql_on "$APP_DB" "SELECT pg_size_pretty(pg_database_size(current_database())) || ', ' || (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()) || ' connections'" 2>&1)"; then echo "ok: database $v"; else warn "database not reachable: $v"; fi
# 3. Application readiness
if [ "$MODE" = docker ]; then
  st="$("${DC[@]}" ps --format '{{.Service}}={{.Health}}{{.State}}' 2>/dev/null | tr '\n' ' ')"; echo "containers: $st"
  "${DC[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && echo "ok: app ready" || warn "app readiness check failed"
else
  curl -fsS -m 5 "http://127.0.0.1:${PORT:-3000}/api/v1/health/ready" >/dev/null && echo "ok: app ready" || warn "app readiness check failed"
fi
# 4. Backup freshness (alert if newest backup is older than 26h)
last="$(latest_backup)"
if [ -z "$last" ]; then warn "no backups found in $BACKUP_DIR"; else
  age=$(( ($(date +%s) - $(stat -c %Y "$last")) / 3600 )); [ "$age" -le 26 ] && echo "ok: newest backup is ${age}h old" || warn "newest backup is ${age}h old"; fi
[ "$problems" = 0 ] && { echo "ALL OK"; exit 0; } || { echo "$problems problem(s) found"; exit 1; }
