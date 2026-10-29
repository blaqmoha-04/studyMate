#!/usr/bin/env bash
# DESTRUCTIVE: replaces the live database with the contents of a backup.
#   deploy/scripts/restore.sh <backup-file>
# Take a fresh backup first if the current data matters. Run restore-test.sh beforehand if you can.
. "$(dirname "$0")/lib.sh"
require_passphrase
file="${1:-}"; [ -n "$file" ] && [ -f "$file" ] || die "Usage: $0 <backup-file>   (see $BACKUP_DIR)"
if [ -f "$file.sha256" ]; then ( cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" >/dev/null ) || die "Checksum mismatch: refusing to restore a corrupted file"; fi
echo "This will REPLACE all data in database '$APP_DB' with the backup:"; echo "  $file"
if [ "${ASSUME_YES:-}" != 1 ]; then read -r -p "Type the database name ($APP_DB) to continue: " ans; [ "$ans" = "$APP_DB" ] || die "Cancelled"; fi

if [ "$MODE" = docker ]; then log "Stopping app and nginx…"; "${DC[@]}" stop nginx app >/dev/null; fi
if [ "$MODE" = local ]; then target="$DATABASE_URL"; else target="$APP_DB"; fi
db_sql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$APP_DB' AND pid <> pg_backend_pid()" >/dev/null || true
log "Restoring…"
decrypt < "$file" | db_restore_into "$target" || { echo "pg_restore reported errors (some are harmless warnings about missing objects). Check the data before reopening the site." >&2; }
if [ "$MODE" = docker ]; then log "Starting app and nginx…"; "${DC[@]}" up -d app nginx >/dev/null; fi
log "Restore finished. Verify by signing in and checking recent data."
