#!/usr/bin/env bash
# Proves a backup works: restores it into a THROWAWAY database, runs sanity checks, then drops it.
# Never touches the live database.   deploy/scripts/restore-test.sh [backup-file]   (default: newest backup)
. "$(dirname "$0")/lib.sh"
require_passphrase
file="${1:-$(latest_backup)}"; [ -n "$file" ] && [ -f "$file" ] || die "No backup file found in $BACKUP_DIR"
SCRATCH="studymate_restore_test"
log "Testing restore of: $file"
if [ -f "$file.sha256" ]; then ( cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256" >/dev/null ) || die "Checksum mismatch: file is corrupted"; log "Checksum OK"; fi

cleanup() { db_sql_admin "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT
db_sql_admin "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null
db_sql_admin "CREATE DATABASE $SCRATCH" >/dev/null

if [ "$MODE" = local ]; then target="$(db_url_for $SCRATCH)"; else target="$SCRATCH"; fi
decrypt < "$file" | db_restore_into "$target" || die "pg_restore reported errors"

fail=0
for t in users sessions assignments class_schedules study_notes exams study_sessions notifications password_reset_tokens schema_migrations; do
  n="$(db_sql_on $SCRATCH "SELECT count(*) FROM $t" 2>/dev/null || echo MISSING)"
  [ "$n" = MISSING ] && { echo "  table $t: MISSING"; fail=1; } || echo "  table $t: $n rows"
done
mig="$(db_sql_on $SCRATCH "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)"
[ "$mig" -ge 1 ] || { echo "  no migrations recorded"; fail=1; }
orphans="$(db_sql_on $SCRATCH "SELECT count(*) FROM assignments a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL" 2>/dev/null || echo 1)"
[ "$orphans" = 0 ] || { echo "  orphaned assignment rows: $orphans"; fail=1; }
if [ "$fail" = 0 ]; then log "RESTORE TEST PASSED — this backup is restorable."; else die "RESTORE TEST FAILED"; fi
