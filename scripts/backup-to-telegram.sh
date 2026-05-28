#!/bin/bash
# ─────────────────────────────────────────────────────────────
# AltivoxAI — Backup Postgres + uploads + .env to Telegram
# Encrypt with GPG, split >50MB, 3-day retention
# Cron: */30 * * * * /opt/reseller-platform/scripts/backup-to-telegram.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config (đọc từ /etc/altivox-backup.conf) ──────────────────
CONF_FILE="/etc/altivox-backup.conf"
if [[ ! -f "$CONF_FILE" ]]; then
  echo "ERROR: missing $CONF_FILE — see template below" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONF_FILE"

: "${BOT_TOKEN:?BOT_TOKEN required in $CONF_FILE}"
: "${CHAT_ID:?CHAT_ID required in $CONF_FILE}"
: "${ENCRYPTION_PASSPHRASE:?ENCRYPTION_PASSPHRASE required}"
: "${POSTGRES_CONTAINER:=reseller-platform-postgres}"
: "${POSTGRES_DB:=reseller_platform}"
: "${POSTGRES_USER:=postgres}"
: "${APP_ROOT:=/opt/reseller-platform}"
: "${RETENTION_DAYS:=3}"
: "${MSG_LOG:=/var/log/altivox-backup-messages.log}"
: "${ERR_LOG:=/var/log/altivox-backup.log}"

TS=$(date +%Y%m%d_%H%M%S)
TMPDIR=$(mktemp -d -t altivox-backup-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

log() { echo "[$(date -Iseconds)] $*" | tee -a "$ERR_LOG"; }

# ── 1. Dump Postgres + encrypt + compress ────────────────────
DB_FILE="${TMPDIR}/db_${TS}.sql.gpg.gz"
log "Dumping Postgres → ${DB_FILE}"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gpg --symmetric --cipher-algo AES256 --batch --quiet \
        --passphrase "$ENCRYPTION_PASSPHRASE" \
  | gzip -9 > "$DB_FILE"

# ── 2. Archive uploads + .env + encrypt ──────────────────────
FILES_FILE="${TMPDIR}/files_${TS}.tar.gpg.gz"
log "Archiving uploads + .env → ${FILES_FILE}"
tar -czf - -C "$APP_ROOT" uploads/ .env 2>/dev/null \
  | gpg --symmetric --cipher-algo AES256 --batch --quiet \
        --passphrase "$ENCRYPTION_PASSPHRASE" \
  | gzip -9 > "$FILES_FILE"

# ── 3. Upload helper (split if >50MB) ────────────────────────
upload_file() {
  local FILE="$1"
  local LABEL="$2"
  local SIZE; SIZE=$(stat -c%s "$FILE")
  local SIZE_MB=$((SIZE / 1024 / 1024))
  local BASENAME; BASENAME=$(basename "$FILE")

  if [[ $SIZE -lt 52000000 ]]; then
    local RESP; RESP=$(curl -sS \
      -F "chat_id=${CHAT_ID}" \
      -F "document=@${FILE}" \
      -F "caption=${LABEL} ${BASENAME} (${SIZE_MB}MB) ${TS}" \
      "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument") || {
        log "Upload FAILED: ${BASENAME}"
        return 1
      }
    local MSG_ID; MSG_ID=$(echo "$RESP" | grep -oP '"message_id":\K[0-9]+' | head -1)
    if [[ -n "$MSG_ID" ]]; then
      echo "${TS} ${MSG_ID}" >> "$MSG_LOG"
      log "Uploaded ${BASENAME} (${SIZE_MB}MB) msg_id=${MSG_ID}"
    fi
  else
    log "Splitting ${BASENAME} (${SIZE_MB}MB) into 49MB chunks"
    split -b 49M -d "$FILE" "${FILE}.part_"
    for part in "${FILE}.part_"*; do
      upload_file "$part" "${LABEL} chunk"
      rm -f "$part"
    done
  fi
}

# ── 4. Upload both files ─────────────────────────────────────
upload_file "$DB_FILE"    "💾 DB"
upload_file "$FILES_FILE" "📁 Files"

# ── 5. Cleanup old messages (>RETENTION_DAYS) ────────────────
if [[ -f "$MSG_LOG" ]]; then
  CUTOFF_TS=$(date -d "${RETENTION_DAYS} days ago" +%Y%m%d_%H%M%S)
  TMP_LOG="${TMPDIR}/msglog.tmp"
  : > "$TMP_LOG"
  while IFS=' ' read -r OLD_TS MSG_ID; do
    if [[ "$OLD_TS" < "$CUTOFF_TS" ]]; then
      curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage?chat_id=${CHAT_ID}&message_id=${MSG_ID}" \
        > /dev/null 2>&1 || true
      log "Deleted old msg_id=${MSG_ID} (${OLD_TS})"
    else
      echo "${OLD_TS} ${MSG_ID}" >> "$TMP_LOG"
    fi
  done < "$MSG_LOG"
  mv "$TMP_LOG" "$MSG_LOG"
fi

log "Backup completed: ${TS}"
