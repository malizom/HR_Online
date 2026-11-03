#!/usr/bin/env bash
# Runs once when the codespace is created: dependencies, secrets for this codespace only, database, build.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pg_isready >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }
if [ ! -f .env ]; then
  cat > .env <<ENV
DATABASE_URL="postgresql://pp_app_login:demo_only_pw@localhost:5432/people_dev"
MIGRATION_DATABASE_URL="postgresql://owner:owner@localhost:5432/people_dev"
DEV_APP_LOGIN_PASSWORD="demo_only_pw"
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_TRUST_HOST="true"
DATA_ENCRYPTION_KEY="$(openssl rand -base64 32)"
UPLOAD_DIR="./uploads"
ENV
fi
# Access code for persona sign-in: a Codespaces secret named DEMO_ACCESS_CODE wins; otherwise one is generated here.
[ -f .devcontainer/.access-code ] || openssl rand -hex 3 | tr a-f A-F | sed 's/^/MVR-/' > .devcontainer/.access-code
npm ci
until pg_isready -h localhost -p 5432 -q; do sleep 1; done
set -a; . ./.env; set +a
npx tsx scripts/migrate.ts
npm run build
