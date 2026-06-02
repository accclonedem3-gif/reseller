# syntax=docker/dockerfile:1.6
#
# Production image for the check_gpt HTTP server (ChatGPT checker).
#
# Stack:
#   • playwright (bundles Chromium via base image) + a tiny built-in-http server on :3000.
#   • Browser-per-request (no pool) — same logic as single-check.js, just over HTTP.
#
# Base image: mcr.microsoft.com/playwright v1.44 ships Chromium + all Linux libs + Node 20.
#
# Volume mounts (compose): /app/proxies.txt — hot-swap proxy list without rebuild.
# Healthcheck: GET /health returns {ok:true}.

FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# server.js (HTTP) + check_gpt.js (checkAccount) + single-check.js (CLI fallback parity).
COPY server.js check_gpt.js single-check.js proxies.txt* accounts.txt* ./

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 3000
CMD ["node", "server.js"]
