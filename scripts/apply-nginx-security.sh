#!/usr/bin/env bash
# Install the repository's hardened Altivox nginx site with validation and automatic rollback.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

repo_root="${RESELLER_REPO_ROOT:-/opt/reseller-platform}"
source_file="$repo_root/deploy/nginx.reseller-platform.conf"
target_file="${ALTIVOX_NGINX_SITE:-/etc/nginx/sites-available/altivoxai}"

if [ ! -f "$source_file" ]; then
  echo "Missing nginx source config: $source_file" >&2
  exit 1
fi

target_dir="$(dirname "$target_file")"
mkdir -p "$target_dir"
backup_file=""

if [ -f "$target_file" ]; then
  backup_file="${target_file}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$target_file" "$backup_file"
  echo "Backup: $backup_file"
fi

install -m 0644 "$source_file" "$target_file"

if ! nginx -t; then
  echo "nginx validation failed; restoring previous configuration." >&2
  if [ -n "$backup_file" ]; then
    cp -a "$backup_file" "$target_file"
  else
    rm -f "$target_file"
  fi
  nginx -t
  exit 1
fi

systemctl reload nginx
echo "nginx security configuration installed and reloaded."
