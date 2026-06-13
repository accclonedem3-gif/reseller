#!/usr/bin/env bash
# Runs ON the server (/opt/reseller-platform) AFTER the new code tarball has been extracted.
# Same steps as deploy.ps1's remote block. Invoked by the GitHub Actions deploy job (and reusable
# by deploy.ps1 if desired). The server .env is never shipped — it stays on the server.
set -e
cd /opt/reseller-platform

echo '[0/4] Remove files deleted from the repo...'
rm -f apps/web/src/pages/login-page-v2.tsx apps/web/src/pages/login-page.tsx

echo '[1/4] Install dependencies...'
export NODE_OPTIONS="--max-old-space-size=3072"
npm ci

echo '[2/4] Run DB migrations...'
npm run db:deploy

echo '[3/4] Build...'
export VITE_API_URL=$(grep -E "^VITE_API_URL=" .env | tail -1 | cut -d= -f2-)
if [ -z "$VITE_API_URL" ]; then
  export VITE_API_URL=$(grep -E "^APP_PUBLIC_URL=" .env | tail -1 | cut -d= -f2-)/api/v1
fi
echo "VITE_API_URL=$VITE_API_URL"
npm run build

echo '[4/4] Restart PM2...'
if pm2 describe reseller-api > /dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

pm2 status
echo 'Deploy xong!'
