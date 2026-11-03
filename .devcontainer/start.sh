#!/usr/bin/env bash
# Runs on every codespace start: makes this codespace's address belong to the demo firm, seeds it once, starts the portal.
set -euo pipefail
cd "$(dirname "$0")/.."
until pg_isready -h localhost -p 5432 -q; do sleep 1; done
set -a; . ./.env; set +a
HOST="${CODESPACE_NAME:-local}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
CODE="${DEMO_ACCESS_CODE:-$(cat .devcontainer/.access-code)}"
# First start seeds the demo (dates relative to today); later starts only register the host.
DEMO_HOSTS="$HOST,demo.localhost" npx tsx db/seed/run.ts
pkill -f "next start -p 3000" 2>/dev/null || true
DEMO_FIRMS=demo DEMO_ACCESS_CODE="$CODE" NODE_ENV=production nohup npx next start -p 3000 > /tmp/portal.log 2>&1 &
gh codespace ports visibility 3000:public -c "${CODESPACE_NAME:-}" >/dev/null 2>&1 || true
cat <<MSG

  ================================================================
   People Portal demo is starting (about 20 seconds).
   Link to share:  https://$HOST
   Access code:    $CODE
   If the link asks for a GitHub login: Ports tab → right-click 3000
   → Port visibility → Public.  Stop the codespace after the meeting.
  ================================================================

MSG
