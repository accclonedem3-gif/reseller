# syntax=docker/dockerfile:1.6
#
# Production image for the CheckGrokJS HTTP fast-path server.
#
# Stack:
#   • puppeteer-extra + stealth + puppeteer-core (browser launched against a system Chrome).
#   • Express HTTP API on :3000 (configurable via PORT env).
#   • CF cookie warmer cron 24/7 (set WARMER=0 to disable).
#
# Base image notes:
#   • ghcr.io/puppeteer/puppeteer pins Chrome + all required system deps (libnss3,
#     libxshmfence, libgbm, fonts, …) for the matching puppeteer-core version.
#     We pin to v21 because package.json specifies puppeteer-core ^21.11.0.
#   • The base image runs as user `pptruser` (uid 1000) for sandbox safety. Chrome
#     refuses to launch as root by default — the image already handles this.
#
# Volume mounts (in docker-compose or k8s):
#   • /tmp/cgrok-profiles  — persistent Chrome profile dirs per proxy (cf_clearance
#     cookies live here across container restarts → cold-start savings ~10s).
#   • /app/proxy.txt       — bind-mount the proxy list so it can be hot-reloaded
#     via POST /admin/reload-proxies without rebuilding the image.
#
# Healthcheck: GET /health returns {ok:true, uptime:N}. Docker / k8s probe this.

FROM ghcr.io/puppeteer/puppeteer:21.11.0

WORKDIR /app

# Skip downloading another Chromium — base image already provides one at PUPPETEER_EXECUTABLE_PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_ENV=production \
    PORT=3000

# Install deps first so this layer caches across code changes.
COPY --chown=pptruser:pptruser package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# App source. proxy.txt is included as a baseline; in production override via volume mount.
COPY --chown=pptruser:pptruser server.js toolgrok.js single-check.js mail2fa.js* proxy.txt* ./

# Healthcheck — base image already ships curl in /usr/bin. 12s start period covers Chrome warmup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 3000
CMD ["node", "server.js"]
