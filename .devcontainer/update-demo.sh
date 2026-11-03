#!/usr/bin/env bash
# After a new version is merged: pull it, rebuild, and reseed fresh demo data. Same link and access code.
#   bash .devcontainer/update-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git checkout main -q && git pull -q --ff-only
npm ci --no-audit --no-fund
set -a; . ./.env; set +a
pkill -f "next-server|next start" 2>/dev/null || true
npm run build
bash .devcontainer/reset-demo.sh
