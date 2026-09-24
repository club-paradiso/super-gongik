#!/usr/bin/env bash
# End-to-end test of the web app's Supabase transport against a real
# PostgREST + PostgreSQL with the migrations and RLS applied. Auth tokens are
# signed locally with a throwaway secret (Supabase Auth itself is not run).
#
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
#   POSTGREST_BIN=/path/to/postgrest \
#     supabase/tests/run-integration.sh
#
# Creates and drops its own database. Never point it at a hosted project.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an admin connection string}"
postgrest="${POSTGREST_BIN:-postgrest}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
db="super_gongik_it_$$"
port="${POSTGREST_PORT:-54330}"
secret="integration-only-secret-$(date +%s)-$$-0000000000"
users="00000000-0000-4000-8000-0000000000a1,00000000-0000-4000-8000-0000000000a2,00000000-0000-4000-8000-0000000000a3,00000000-0000-4000-8000-0000000000a4"

url_for() {
  python3 -c 'import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
netloc = p.netloc if len(sys.argv) < 4 else sys.argv[3] + "@" + p.netloc.split("@")[-1]
print(p._replace(path="/" + sys.argv[2], netloc=netloc).geturl())' "$@"
}

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create database $db"
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  psql "$DATABASE_URL" -q -c "drop database if exists $db with (force)" >/dev/null
}
trap cleanup EXIT

test_url="$(url_for "$DATABASE_URL" "$db")"
run() { psql "$test_url" -v ON_ERROR_STOP=1 -q -X "$@"; }
run -f "$here/shim/supabase-auth.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  run -o /dev/null -f "$migration"
done
run -c "insert into auth.users (id) select unnest(string_to_array('$users', ','))::uuid"

PGRST_DB_URI="$(url_for "$DATABASE_URL" "$db" "authenticator:authenticator")" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$secret" \
PGRST_SERVER_PORT="$port" \
  "$postgrest" >"${TMPDIR:-/tmp}/postgrest-$$.log" 2>&1 &
pid=$!

for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:$port/" >/dev/null

cd "$root"
SUPER_GONGIK_IT_REST_URL="http://127.0.0.1:$port" \
SUPER_GONGIK_IT_JWT_SECRET="$secret" \
SUPER_GONGIK_IT_USERS="$users" \
  pnpm --filter @super-gongik/web exec vitest run tests/supabase-transport.integration.test.ts
