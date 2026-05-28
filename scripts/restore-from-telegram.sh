#!/bin/bash
# ─────────────────────────────────────────────────────────────
# AltivoxAI — Restore từ backup Telegram
# Usage:
#   ./restore-from-telegram.sh db /tmp/db_20260525_140000.sql.gpg.gz
#   ./restore-from-telegram.sh files /tmp/files_20260525_140000.tar.gpg.gz
# ─────────────────────────────────────────────────────────────

set -euo pipefail

CONF_FILE="/etc/altivox-backup.conf"
if [[ ! -f "$CONF_FILE" ]]; then
  echo "ERROR: missing $CONF_FILE"
  exit 1
fi
# shellcheck disable=SC1090
source "$CONF_FILE"

MODE="${1:-}"
FILE="${2:-}"

if [[ -z "$MODE" || -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <db|files> <path-to-backup-file>"
  echo "Steps trước khi chạy:"
  echo "  1. Download backup từ chat Telegram về VPS (/tmp/...)"
  echo "  2. Nếu file bị split (.part_aa, .part_ab, ...) → ghép lại:"
  echo "     cat backup.part_* > backup.gpg.gz"
  exit 1
fi

case "$MODE" in
  db)
    echo "🛑 Stopping API + worker..."
    pm2 stop reseller-api reseller-worker 2>/dev/null || true

    echo "🗑️  Drop + recreate DB..."
    docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
    docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -c "CREATE DATABASE ${POSTGRES_DB};"

    echo "📥 Restoring DB từ ${FILE}..."
    gunzip < "$FILE" \
      | gpg --decrypt --batch --quiet --passphrase "$ENCRYPTION_PASSPHRASE" \
      | docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB"

    echo "✅ DB restored. Running prisma migrate to sync schema..."
    cd "$APP_ROOT"
    npm run db:deploy || echo "⚠️  prisma migrate failed — check manually"

    echo "🚀 Starting API + worker..."
    pm2 restart all
    echo "✅ Done. Check 'pm2 logs --lines 50'"
    ;;

  files)
    echo "📥 Restoring uploads + .env từ ${FILE}..."
    gunzip < "$FILE" \
      | gpg --decrypt --batch --quiet --passphrase "$ENCRYPTION_PASSPHRASE" \
      | tar -xzf - -C "$APP_ROOT"
    echo "✅ Files restored to ${APP_ROOT}"
    echo "⚠️  Lưu ý: .env đã bị overwrite — kiểm tra trước khi restart"
    ;;

  *)
    echo "Unknown mode: $MODE (use 'db' or 'files')"
    exit 1
    ;;
esac
