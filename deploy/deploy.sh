#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm ci

echo "Generating Prisma client..."
npx prisma generate --schema prisma/schema.prisma

if [ -f .env ]; then
  VITE_API_URL_VALUE="$(grep -E '^VITE_API_URL=' .env | tail -n 1 | cut -d= -f2- || true)"

  if [ -z "$VITE_API_URL_VALUE" ]; then
    APP_PUBLIC_URL_VALUE="$(grep -E '^APP_PUBLIC_URL=' .env | tail -n 1 | cut -d= -f2- || true)"

    if [ -n "$APP_PUBLIC_URL_VALUE" ]; then
      VITE_API_URL_VALUE="${APP_PUBLIC_URL_VALUE%/}/api/v1"
    fi
  fi

  if [ -n "$VITE_API_URL_VALUE" ]; then
    export VITE_API_URL="$VITE_API_URL_VALUE"
  fi
fi

echo "Building workspaces..."
npm run build

echo "Applying database migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma

echo "Reloading PM2 processes..."
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

echo "Deployment complete."
