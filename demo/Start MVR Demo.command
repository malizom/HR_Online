#!/usr/bin/env bash
# Double-click to start the People Portal demo on this Mac. Needs Docker Desktop (free for small businesses).
cd "$(dirname "$0")"
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running. Install it from https://www.docker.com/products/docker-desktop/ , start it, then double-click this file again."
  read -n1 -r -p "Press any key to close…"; exit 1
fi
if [ ! -f .env ]; then
  { echo "AUTH_SECRET=$(openssl rand -base64 32)"; echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)";
    echo "DEMO_ACCESS_CODE=MVR-$(openssl rand -hex 3 | tr a-f A-F)"; } > .env
fi
if [ "${1:-}" = "--fresh" ]; then docker compose down -v; fi
echo "Starting the demo (the first time takes a few minutes to build)…"
docker compose up -d --build || { read -n1 -r -p "Something went wrong — press any key"; exit 1; }
until curl -fs http://localhost:3000/api/ready >/dev/null 2>&1; do sleep 2; printf "."; done
CODE=$(grep DEMO_ACCESS_CODE .env | cut -d= -f2)
echo; echo "Ready:  http://localhost:3000    Access code: $CODE"
open "http://localhost:3000/signin"
read -n1 -r -p "Leave this window open during the demo. Press any key to stop the demo…"
docker compose stop
