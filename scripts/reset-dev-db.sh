#!/usr/bin/env bash
# Development only: drop and recreate the local database, migrate, seed. Refuses to run against non-local hosts.
set -euo pipefail
url="${MIGRATION_DATABASE_URL:?}"
case "$url" in *@localhost*|*@127.0.0.1*) ;; *) echo "refusing: not a local database"; exit 1;; esac
db="${url##*/}"; admin="${url%/*}/postgres"
psql "$admin" -qc "drop database if exists \"$db\" with (force)" -c "create database \"$db\""
npx tsx scripts/migrate.ts
npx tsx db/seed/run.ts
