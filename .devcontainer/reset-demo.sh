#!/usr/bin/env bash
# Fresh demo data before a meeting (all leave dates are re-based on today). Keeps the same link and access code.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
psql "postgresql://owner:owner@localhost:5432/postgres" -qc "drop database if exists people_dev with (force)" -c "create database people_dev"
npx tsx scripts/migrate.ts
bash .devcontainer/start.sh
