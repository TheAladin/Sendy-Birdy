#!/usr/bin/env bash
# Creates the `sendy` role and the `sendy` and `sendy_test` databases on the local PostgreSQL
# server (plus `sendy_backup_test` and `sendy_restore_test` for the backup tests, which need
# committed data), and records the connection URLs in .env. Safe to run again: existing
# databases are kept and the role's password is reset to the one already stored in .env.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
PSQL_ADMIN="${PSQL_ADMIN:-sudo -u postgres psql -d postgres}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE not found; run 'make install' first." >&2
  exit 1
fi

# Sets KEY=value in .env: fills in an empty `KEY=` line if there is one, appends otherwise.
set_env() {
  if grep -q "^$1=$" "$ENV_FILE"; then
    sed -i "s|^$1=$|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
  fi
}

current="$(sed -n 's|^DATABASE_URL=||p' "$ENV_FILE" | tail -n 1)"
password="$(sed -n 's|^postgresql+asyncpg://sendy:\([^@]*\)@.*|\1|p' <<<"$current")"
if [[ -n "$current" && -z "$password" ]]; then
  echo "DATABASE_URL in $ENV_FILE points somewhere else; leaving your database alone." >&2
  exit 1
fi
if [[ -z "$password" ]]; then
  password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  set_env DATABASE_URL "postgresql+asyncpg://sendy:${password}@${DB_HOST}:${DB_PORT}/sendy"
  set_env TEST_DATABASE_URL "postgresql+asyncpg://sendy:${password}@${DB_HOST}:${DB_PORT}/sendy_test"
  echo "Added DATABASE_URL and TEST_DATABASE_URL to $ENV_FILE"
fi

# The SQL goes in through stdin so the password never shows up in the process list.
$PSQL_ADMIN -p "$DB_PORT" -v ON_ERROR_STOP=1 -q <<SQL
SELECT 'CREATE ROLE sendy' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sendy')\gexec
ALTER ROLE sendy WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';
SELECT 'CREATE DATABASE sendy OWNER sendy'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sendy')\gexec
SELECT 'CREATE DATABASE sendy_test OWNER sendy'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sendy_test')\gexec
SELECT 'CREATE DATABASE sendy_backup_test OWNER sendy'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sendy_backup_test')\gexec
SELECT 'CREATE DATABASE sendy_restore_test OWNER sendy'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sendy_restore_test')\gexec
SQL

echo "PostgreSQL is ready: sendy, sendy_test, sendy_backup_test and sendy_restore_test, owned by sendy."
