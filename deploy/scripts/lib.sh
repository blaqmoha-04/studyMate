# Shared helpers for StudyMate operations scripts. Sourced, not executed.
# Two modes:
#   docker (default): talks to the PostgreSQL container via `docker compose exec`.
#   local:            STUDYMATE_DB_MODE=local with DATABASE_URL set (used for development and for testing these scripts).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
MODE="${STUDYMATE_DB_MODE:-docker}"

# Read one KEY from .env without `source`-ing it (values may contain spaces, <, > or inline comments).
env_get() {
  local key="$1" def="${2:-}" val=""
  if [ -f "$ROOT/.env" ]; then
    val="$(grep -E "^${key}=" "$ROOT/.env" | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  fi
  printf '%s' "${val:-$def}"
}
die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

PGUSER_="$(env_get POSTGRES_USER studymate)"; PGDB_="$(env_get POSTGRES_DB studymate)"
BACKUP_DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR ./backups)}"; case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$ROOT/${BACKUP_DIR#./}";; esac
PASSFILE="${BACKUP_PASSPHRASE_FILE:-$(env_get BACKUP_PASSPHRASE_FILE ./secrets/backup_passphrase)}"; case "$PASSFILE" in /*) ;; *) PASSFILE="$ROOT/${PASSFILE#./}";; esac
KEEP_DAYS="${BACKUP_KEEP_DAYS:-$(env_get BACKUP_KEEP_DAYS 14)}"
REMOTE="${BACKUP_REMOTE:-$(env_get BACKUP_REMOTE '')}"

if [ "$MODE" = local ]; then
  [ -n "${DATABASE_URL:-}" ] || die "STUDYMATE_DB_MODE=local needs DATABASE_URL"
  ADMIN_URL="${DATABASE_URL%/*}/postgres"; DBNAME="${DATABASE_URL##*/}"; DBNAME="${DBNAME%%\?*}"
  db_dump()         { pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"; }
  db_restore_list() { pg_restore --list >/dev/null; }
  db_restore_into() { pg_restore --no-owner --no-privileges --clean --if-exists --dbname "${1}"; }   # arg: connection URL
  db_url_for()      { echo "${DATABASE_URL%/*}/$1"; }
  db_sql_admin()    { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qtAc "$1"; }
  db_sql_on()       { psql "$(db_url_for "$1")" -v ON_ERROR_STOP=1 -qtAc "$2"; }
  APP_DB="$DBNAME"
else
  command -v docker >/dev/null || die "docker not found (set STUDYMATE_DB_MODE=local for a non-Docker database)"
  DC=(docker compose)
  db_dump()         { "${DC[@]}" exec -T db pg_dump --format=custom --no-owner --no-privileges -U "$PGUSER_" -d "$PGDB_"; }
  db_restore_list() { "${DC[@]}" exec -T db pg_restore --list >/dev/null; }
  db_restore_into() { "${DC[@]}" exec -T db pg_restore --no-owner --no-privileges --clean --if-exists -U "$PGUSER_" -d "${1}"; }   # arg: database NAME
  db_url_for()      { echo "$1"; }
  db_sql_admin()    { "${DC[@]}" exec -T db psql -U "$PGUSER_" -d postgres -v ON_ERROR_STOP=1 -qtAc "$1"; }
  db_sql_on()       { "${DC[@]}" exec -T db psql -U "$PGUSER_" -d "$1" -v ON_ERROR_STOP=1 -qtAc "$2"; }
  APP_DB="$PGDB_"
fi

# Authenticated symmetric encryption (AES-256, with integrity check) using the passphrase file.
require_passphrase() {
  [ -s "$PASSFILE" ] || die "Backup passphrase file missing or empty: $PASSFILE
Create it:  mkdir -p secrets && openssl rand -base64 36 > secrets/backup_passphrase && chmod 600 secrets/backup_passphrase
THEN COPY IT SOMEWHERE SAFE OFF THIS SERVER (password manager). Without it, backups cannot be decrypted."
  local perm; perm="$(stat -c %a "$PASSFILE" 2>/dev/null || echo 600)"
  case "$perm" in 600|400) ;; *) die "Passphrase file permissions are $perm; run: chmod 600 $PASSFILE";; esac
}
encrypt() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSFILE" --symmetric --cipher-algo AES256 -o -; }
decrypt() { gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSFILE" --decrypt; }
latest_backup() { ls -1t "$BACKUP_DIR"/studymate-*.dump.gpg 2>/dev/null | head -1 || true; }
