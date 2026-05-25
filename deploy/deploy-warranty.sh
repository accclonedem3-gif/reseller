#!/usr/bin/env bash
# Production deploy for the warranty-augmented reseller monorepo.
#
# Assumes:
#   - Already on the VPS (run via SSH).
#   - `git pull` happened OUTSIDE this script — user is in control of which branch is checked
#     out (they deploy from the merged warranty branch).
#   - First-time host setup (Chromium deps, swap, Postgres tune) already done — see
#     `deploy/setup-vps.sh` for that one-shot script.
#
# Run:
#   cd /opt/reseller && bash deploy/deploy-warranty.sh
#
# What it does (idempotent — safe to re-run):
#   1. Verify expected sibling tool dirs exist + their npm deps are installed.
#   2. Install reseller monorepo deps (npm ci — clean lockfile-based).
#   3. Generate Prisma client.
#   4. Build all workspaces (shared first → api → worker → web). Critical: shared has to be
#      built BEFORE api/worker because they import `@reseller/shared` from `dist/`.
#   5. Apply DB migrations.
#   6. PM2 startOrReload using the updated ecosystem (api + worker + grok-server).
#
# Bail-out behavior:
#   - `set -euo pipefail`: any command fail → exit non-zero, no half-deploy.
#   - Tool-dir checks WARN but don't block — admin may have deferred installing one tool.
#   - PM2 reload is the last step; if anything before fails, processes keep running on
#     the previous code, which is exactly what we want.

set -euo pipefail

# Resolve repo root regardless of how the script was invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Color helpers — make the deploy log scannable. NO_COLOR=1 disables.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BLUE='\033[1;34m'
  C_GREEN='\033[1;32m'
  C_YELLOW='\033[1;33m'
  C_RED='\033[1;31m'
  C_RESET='\033[0m'
else
  C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_RESET=''
fi

step()  { printf "${C_BLUE}━━━ %s ━━━${C_RESET}\n" "$1"; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$1"; }
warn()  { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$1"; }
die()   { printf "${C_RED}✗${C_RESET} %s\n" "$1" >&2; exit 1; }

# ────────────────────────────────────────────────────────────────────────────
step "1. Verify sibling tool dirs (warranty auto-check tools)"
# ────────────────────────────────────────────────────────────────────────────
# The 3 tools (check_veo, check_gpt, CheckGrokJS) live OUTSIDE the reseller repo as siblings.
# Worker spawns their single-check.js subprocesses. Check existence + npm install state.
TOOL_PARENT="$(cd "$REPO_ROOT/.." && pwd)"

check_tool() {
  local name="$1"
  local dir="$TOOL_PARENT/$name"
  if [ ! -d "$dir" ]; then
    warn "$name not found at $dir — warranty checks for this tool will fail. Clone the repo or set CHECK_${name^^}_PATH env if it's elsewhere."
    return 0
  fi
  if [ ! -d "$dir/node_modules" ]; then
    warn "$name has no node_modules — running npm install"
    (cd "$dir" && npm install --no-audit --no-fund) || die "npm install failed for $name"
  fi
  ok "$name ready at $dir"
}

check_tool "check_veo"
check_tool "CheckGrokJS"
# check_gpt is disabled by default (WARRANTY_DISABLED_TOOLS=gpt) — skip the check
if [ -n "${ENABLE_GPT_TOOL:-}" ]; then
  check_tool "check_gpt"
fi

# Playwright Chromium for check_veo. `npx playwright install --with-deps chromium` is heavy
# (downloads ~200MB) — only run if browsers/ dir is missing. Skip with SKIP_PLAYWRIGHT=1 if
# the admin handles browser installs manually.
if [ -z "${SKIP_PLAYWRIGHT:-}" ] && [ -d "$TOOL_PARENT/check_veo" ]; then
  if [ ! -d "$TOOL_PARENT/check_veo/node_modules/playwright-core/.local-browsers" ] && \
     [ ! -d "$HOME/.cache/ms-playwright" ]; then
    warn "Playwright Chromium not installed for check_veo — running npx playwright install"
    (cd "$TOOL_PARENT/check_veo" && npx playwright install chromium) || \
      warn "playwright install failed — install OS deps manually: sudo npx playwright install-deps"
  else
    ok "Playwright Chromium present"
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
step "2. Install reseller monorepo dependencies (npm ci)"
# ────────────────────────────────────────────────────────────────────────────
# npm ci is stricter than `npm install` — fails if package-lock.json out of sync, which is
# what we want in prod. Don't fall back to install on failure.
if [ ! -f package-lock.json ]; then
  die "package-lock.json missing — run 'npm install' once on a dev box and commit the lockfile"
fi
npm ci --no-audit --no-fund
ok "Dependencies installed"

# ────────────────────────────────────────────────────────────────────────────
step "3. Generate Prisma client"
# ────────────────────────────────────────────────────────────────────────────
# Prisma client is generated from schema.prisma — must run before TypeScript build so types
# resolve. `npm run build` would also generate it via prebuild hook, but we do it explicitly
# so a build failure here is reported separately.
npx prisma generate --schema prisma/schema.prisma
ok "Prisma client regenerated"

# ────────────────────────────────────────────────────────────────────────────
step "4. Build workspaces (shared → api → worker → web)"
# ────────────────────────────────────────────────────────────────────────────
# Critical ordering: shared package builds FIRST so api/worker can resolve `@reseller/shared`
# from its dist/. The root build script (`npm run build`) chains them in the right order
# already; this is defensive in case the build script changes.
#
# If VITE_API_URL isn't set explicitly, derive it from APP_PUBLIC_URL so the web build bakes
# in the correct API host. Without this the web bundle points at "localhost:3000" — broken
# in prod.
if [ -f .env ]; then
  if [ -z "${VITE_API_URL:-}" ]; then
    APP_PUBLIC_URL_VALUE="$(grep -E '^APP_PUBLIC_URL=' .env | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$APP_PUBLIC_URL_VALUE" ]; then
      export VITE_API_URL="${APP_PUBLIC_URL_VALUE%/}/api/v1"
      ok "VITE_API_URL derived from APP_PUBLIC_URL → $VITE_API_URL"
    fi
  fi
fi

npm run build
ok "All workspaces built"

# ────────────────────────────────────────────────────────────────────────────
step "5. Apply database migrations"
# ────────────────────────────────────────────────────────────────────────────
# `migrate deploy` only applies — never modifies the schema (that's `migrate dev`). Safe to
# run repeatedly. Fails loudly if a previous migration is in a broken state, which is what
# we want to investigate before rolling forward.
npx prisma migrate deploy --schema prisma/schema.prisma
ok "Migrations applied"

# ────────────────────────────────────────────────────────────────────────────
step "6. Sync warranty.check.proxies → CheckGrokJS/proxy.txt"
# ────────────────────────────────────────────────────────────────────────────
# The grok server reads proxy.txt at boot. Admin's `warranty.check.proxies` config is the
# source of truth. The API auto-syncs on admin UPDATE (see AdminService.syncProxiesToGrokServer),
# but on first deploy the admin hasn't touched anything yet — pull whatever's in DB now so
# the grok server's first boot uses the right list. No-op if config is empty (warmer falls
# back to its existing proxy.txt if it exists, or runs with 0 proxies).
GROK_PROXY_FILE="${CHECK_GROK_PROXY_FILE:-$TOOL_PARENT/CheckGrokJS/proxy.txt}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -d "$(dirname "$GROK_PROXY_FILE")" ] && [ -n "${DATABASE_URL:-}" ]; then
  # Use node to query — avoids needing psql client installed on the VPS.
  PROXIES="$(node -e "
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient();
      const row = await p.systemConfig.findUnique({ where: { key: 'warranty.check.proxies' } });
      if (row?.value) process.stdout.write(row.value);
      await p.\$disconnect();
    })().catch(() => process.exit(0));
  " 2>/dev/null || true)"
  if [ -n "$PROXIES" ]; then
    printf "%s\n" "$PROXIES" > "$GROK_PROXY_FILE"
    ok "proxy.txt synced from DB → $GROK_PROXY_FILE ($(echo "$PROXIES" | grep -cv '^[[:space:]]*$') lines)"
  else
    warn "DB has no warranty.check.proxies set yet — grok server will run with whatever's in proxy.txt or empty"
  fi
else
  warn "Skipped proxy sync (path $GROK_PROXY_FILE or DATABASE_URL missing)"
fi

# ────────────────────────────────────────────────────────────────────────────
step "7. PM2 reload (api + worker + grok-server)"
# ────────────────────────────────────────────────────────────────────────────
# startOrReload = zero-downtime swap if already running, or fresh start if not. Reads the
# updated ecosystem.config.cjs which includes the grok-server entry. After this, PM2 will
# auto-restart processes that exceed max_memory_restart limits.
#
# `pm2 save` persists the process list so a server reboot (or pm2 resurrect) restores them.
# Make sure `pm2 startup` was run once during host setup so PM2 itself starts at boot.
if ! command -v pm2 >/dev/null 2>&1; then
  die "pm2 not installed — run 'npm install -g pm2' once on the host"
fi

pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
ok "PM2 reloaded — api + worker + grok-server"

# ────────────────────────────────────────────────────────────────────────────
step "Deploy complete"
# ────────────────────────────────────────────────────────────────────────────
printf "\n"
ok "Health check:"
printf "    %s api      :  curl http://localhost:3000/api/v1/warranty/claims/x/auto-check\n"  '•'
printf "    %s worker   :  pm2 logs reseller-worker | grep 'Worker started'\n"                 '•'
printf "    %s grok srv :  curl http://localhost:4001/stats\n"                                 '•'
printf "\n"
ok "Monitor with: pm2 monit"
