#!/usr/bin/env bash
# Apply the migrations to a fresh throwaway database and run the SQL policy
# tests. Needs psql and a PostgreSQL 15+ server you may create databases on:
#
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
#     supabase/tests/run-db-tests.sh
#
# Plain PostgreSQL gets supabase/tests/shim/supabase-auth.sql first (roles,
# auth.users, auth.uid()). Set SKIP_AUTH_SHIM=1 when the server already is a
# local Supabase database. Never point this at a hosted project.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an admin connection string}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
db="super_gongik_test_$$"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create database $db"
cleanup() { psql "$DATABASE_URL" -q -c "drop database if exists $db with (force)" >/dev/null; }
trap cleanup EXIT

test_url="$(python3 -c 'import sys, urllib.parse as u; p = u.urlparse(sys.argv[1]); print(p._replace(path="/" + sys.argv[2]).geturl())' "$DATABASE_URL" "$db")"
run() { psql "$test_url" -v ON_ERROR_STOP=1 -q -X "$@"; }

if [ "${SKIP_AUTH_SHIM:-0}" != "1" ]; then
  run -f "$here/shim/supabase-auth.sql"
fi
for migration in "$root"/supabase/migrations/*.sql; do
  run -o /dev/null -f "$migration"
done
for test in "$here"/database/*.test.sql; do
  run -o /dev/null -f "$test"
done
