# syntax=docker/dockerfile:1.6
#
# Production image for the check_veo HTTP fast-path server.
#
# Stack:
#   • playwright (full version, bundles its own Chromium) + Express HTTP API on :3000.
#   • Persistent browser context pool per proxy — `launchPersistentContext` keeps cookies
#     and DNS cache hot across customer logins, saving the ~3-5s Chromium cold launch tax.
#
# Base image:
#   • mcr.microsoft.com/playwright matches the @playwright/test version (currently 1.44).
#     It ships Chromium + every Linux library Chromium needs, plus a non-root `pwuser`.
#   • We bring in playwright as a dependency (not @playwright/test) — same browser binary path.
#
# Volume mounts (in docker-compose or k8s):
#   • /home/pwuser/.cache/playwright-profiles  — bind to persist browser contexts so the
#     pool survives container restarts (otherwise every redeploy = cold start).
#   • /app/proxies.txt                          — hot-reload proxy list without rebuild.
#
# Healthcheck: GET /stats returns 200 with browser pool counts.

FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    # Tell Playwright to skip its own browser download — the base image already shipped them.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install deps. The base image has Node 20 already.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# App source. Brings the worker entry (server.js) + the browser-launching code (check_veo.js)
# + the per-account CLI wrapper (single-check.js) so the same image can serve both
# subprocess and HTTP integration paths if needed.
COPY server.js check_veo.js single-check.js proxies.txt* accounts.txt* ./

# Healthcheck — /stats is the lightweight probe. /check would actually launch a browser; avoid.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/stats || exit 1

EXPOSE 3000
CMD ["node", "server.js"]
