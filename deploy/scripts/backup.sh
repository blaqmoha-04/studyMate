#!/usr/bin/env bash
# Encrypted PostgreSQL backup with integrity check, retention and optional off-server copy.
#   deploy/scripts/backup.sh
# A backup is NOT proven good until deploy/scripts/restore-test.sh has restored it successfully.
. "$(dirname "$0")/lib.sh"
require_passphrase
command -v gpg >/dev/null || die "gpg is required (apt install gnupg)"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"; out="$BACKUP_DIR/studymate-$ts.dump.gpg"; tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

log "Dumping database '$APP_DB' and encrypting…"
db_dump | encrypt > "$tmp"
[ -s "$tmp" ] || die "Backup file is empty"

log "Verifying the archive can be decrypted and read…"
decrypt < "$tmp" | db_restore_list || die "Verification failed: archive is unreadable. Backup discarded."

mv "$tmp" "$out"; chmod 600 "$out"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )
size="$(du -h "$out" | cut -f1)"
log "Backup written: $out ($size)"

# Retention
find "$BACKUP_DIR" -maxdepth 1 -name 'studymate-*.dump.gpg' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/pruned: /'
find "$BACKUP_DIR" -maxdepth 1 -name 'studymate-*.dump.gpg.sha256' -mtime +"$KEEP_DAYS" -delete

# Off-server copy (strongly recommended: a backup on the same disk dies with the server)
if [ -n "$REMOTE" ]; then
  command -v rsync >/dev/null || die "BACKUP_REMOTE set but rsync not installed"
  log "Copying to $REMOTE …"
  rsync -a --partial "$out" "$out.sha256" "$REMOTE" || die "OFF-SERVER COPY FAILED (local backup kept at $out)"
  log "Off-server copy complete."
else
  echo "WARNING: BACKUP_REMOTE is not set. This backup exists only on this server." >&2
fi
echo "Reminder: this backup is unproven until you run: deploy/scripts/restore-test.sh"
