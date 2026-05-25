#!/usr/bin/env bash
# One-shot first-time VPS prep for the warranty-augmented reseller. Run ONCE on a fresh VPS
# before the first `deploy-warranty.sh`. After that, just `deploy-warranty.sh` for updates.
#
# Targets Ubuntu 22.04 / 24.04 on a 4GB VPS. Requires sudo.
#
# What it does:
#   1. apt install: Chromium runtime deps, build tools, postgres-client, nodejs (if missing),
#                   pm2 (npm global), fonts for Chrome rendering.
#   2. 4GB swap file (Chromium spikes when N parallel checks land).
#   3. sysctl tuning: vm.swappiness=10 (don't aggressively swap), inotify watchers raised
#      (tsx watch + Chromium can exhaust the default 8192).
#   4. Postgres tuning for 4GB host: lowers shared_buffers + work_mem from defaults that
#      assume 32GB+, sets max_connections=50 (fork-mode Nest doesn't need 100).
#   5. PM2 startup (auto-start at boot).
#   6. Cron entry for log rotation (PM2's built-in is fine but its defaults retain too much).
#
# Run:
#   sudo bash deploy/setup-vps.sh
#
# Re-running is safe (idempotent) but waste of time — only do it again after a major OS
# upgrade or if you suspect something got rolled back.

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "✗ Must run as root (sudo bash deploy/setup-vps.sh)" >&2
  exit 1
fi

echo "━━━ 1. apt install system deps ━━━"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y \
  curl ca-certificates gnupg lsb-release build-essential git \
  postgresql-client \
  fonts-liberation fonts-noto-color-emoji \
  libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgconf-2-4 libasound2 libatk-bridge2.0-0 libatspi2.0-0 \
  libnss3 libpangocairo-1.0-0 libcups2 libdrm2 libxshmfence1
echo "✓ System deps installed"

# Node 20 if not present (Reseller uses ES2022 + Prisma 6).
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  echo "━━━ Installing Node 20 ━━━"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "✓ node $(node -v) / npm $(npm -v)"

# PM2 — process manager. Global install; user-level alternative is fine but global plays nice
# with `pm2 startup`.
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
  echo "✓ pm2 installed"
fi

echo ""
echo "━━━ 2. 4GB swap file (safety net) ━━━"
# Tied to Chromium parallelism: even with max_memory_restart caps in PM2, a burst of warranty
# claims can briefly push RAM past physical. Swap absorbs it; without swap the OOM killer
# picks a victim (often postgres or worker) and the system stalls.
if [ -f /swapfile ]; then
  echo "✓ /swapfile already exists ($(du -h /swapfile | cut -f1))"
else
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q "^/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "✓ 4GB swap created and enabled"
fi

# Swappiness 10 = prefer RAM strongly, only swap when really needed. Default 60 swaps too
# aggressively for our workload (Chromium pages get swapped → 5x slower checks).
sysctl -w vm.swappiness=10 >/dev/null
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi
echo "✓ vm.swappiness=10"

# Inotify watchers — tsx watch (dev only, harmless in prod), Chromium, postgres all eat
# watchers. Default 8192 = easy to hit. 524288 is the docker-recommended ceiling.
sysctl -w fs.inotify.max_user_watches=524288 >/dev/null
if ! grep -q "fs.inotify.max_user_watches" /etc/sysctl.conf; then
  echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf
fi
echo "✓ inotify watchers raised"

echo ""
echo "━━━ 3. Postgres tuning (4GB host) ━━━"
# Only tune if postgres is locally installed AND we can find its conf. Skips silently if
# user uses managed Postgres (RDS / Railway / Supabase) — those should be tuned via their UI.
PG_CONF="$(ls -1 /etc/postgresql/*/main/postgresql.conf 2>/dev/null | head -1 || true)"
if [ -n "$PG_CONF" ]; then
  BACKUP="$PG_CONF.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$PG_CONF" "$BACKUP"
  echo "  Backup: $BACKUP"

  apply_pg_setting() {
    local key="$1" val="$2"
    # Comment out any existing line, then append the new value at the end. Idempotent.
    sed -i -E "s/^[[:space:]]*${key}[[:space:]]*=.*/# &/" "$PG_CONF"
    echo "${key} = ${val}  # set by setup-vps.sh" >> "$PG_CONF"
  }
  apply_pg_setting "shared_buffers"        "256MB"
  apply_pg_setting "work_mem"              "4MB"
  apply_pg_setting "maintenance_work_mem"  "64MB"
  apply_pg_setting "effective_cache_size"  "1GB"
  apply_pg_setting "max_connections"       "50"

  systemctl restart postgresql || true
  echo "✓ Postgres tuned + restarted"
else
  echo "  (No local Postgres found — skipping. Tune your managed instance via its UI.)"
fi

echo ""
echo "━━━ 4. PM2 startup at boot ━━━"
# Only effective if a non-root user runs pm2. If the deploy user is root that's fine but not
# recommended. Pass through whatever pm2 startup outputs (it tells the admin what command to
# run for their actual deploy user).
pm2 startup systemd -u "${SUDO_USER:-root}" --hp "/home/${SUDO_USER:-root}" 2>&1 | tail -5
echo "✓ PM2 startup configured (see message above for any sudo follow-up)"

echo ""
echo "━━━ 5. PM2 log rotation ━━━"
# Without this, pm2 logs grow unbounded. 10MB rotation, keep 7 archives = max ~70MB per app.
if ! pm2 list pm2-logrotate >/dev/null 2>&1; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
echo "✓ pm2-logrotate: 10MB × 7 archives"

echo ""
echo "━━━ Setup complete ━━━"
echo ""
echo "Next steps:"
echo "  1. Clone the 3 tool repos as siblings of reseller/:"
echo "       /opt/check_veo, /opt/check_gpt (optional), /opt/CheckGrokJS"
echo "  2. cd /opt/check_veo && npm install && npx playwright install chromium"
echo "  3. cd /opt/CheckGrokJS && npm install"
echo "  4. cd /opt/reseller && cp deploy/production.env.example .env"
echo "  5. Edit .env: DATABASE_URL, REDIS_URL, APP_PUBLIC_URL, INTERNAL_API_TOKEN, etc."
echo "  6. bash deploy/deploy-warranty.sh"
