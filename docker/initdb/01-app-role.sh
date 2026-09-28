#!/bin/sh
# Creates the non-superuser runtime role the app connects as.
# Row level security only protects queries run by a role that is NOT a superuser
# and does NOT own the tables - that's this role.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bos_app') THEN
      CREATE ROLE bos_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END \$\$;
SQL
