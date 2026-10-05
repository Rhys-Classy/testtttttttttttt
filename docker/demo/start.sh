#!/bin/sh
# DEMO ONLY: start a private Postgres, migrate, seed fake demo data, run the app + worker.
set -e
PGDATA=/tmp/pgdata
mkdir -p "$PGDATA" /run/postgresql && chown postgres:postgres "$PGDATA" /run/postgresql
su-exec postgres initdb -D "$PGDATA" -A trust -U postgres >/dev/null
su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c shared_buffers=32MB -c max_connections=40" -w start >/dev/null
psql -h 127.0.0.1 -U postgres -q -c "create role bos_admin login superuser password 'demo-admin'" \
  -c "create role bos_app login password 'demo-app' nosuperuser nobypassrls" -c "create database bos owner bos_admin"

export DATABASE_ADMIN_URL=postgres://bos_admin:demo-admin@127.0.0.1:5432/bos
export DATABASE_URL=postgres://bos_app:demo-app@127.0.0.1:5432/bos
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
export SEED_DEMO=1

npx tsx src/db/migrate.ts
npx tsx src/db/seed.ts --demo

# Background worker (automations, reminders). Development mode = email/SMS go to the log, nothing is really sent.
NODE_ENV=development WORKER_FAST_MS=10000 npx tsx src/worker/index.ts &
exec npx next start -p "${PORT:-10000}" -H 0.0.0.0
