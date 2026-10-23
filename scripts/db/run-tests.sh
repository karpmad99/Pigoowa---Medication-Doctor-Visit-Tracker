#!/usr/bin/env bash
# Applies supabase/migrations to a fresh scratch database on a plain PostgreSQL
# server, with a minimal Supabase emulation (scripts/db/supabase-emulation.sql),
# then runs the pgTAP files from supabase/tests/database.
#
# This is a stand-in for `supabase db reset && supabase test db` when Docker and
# the Supabase CLI are unavailable. It does not replace running those.
#
# Environment (all optional):
#   PGHOST / PGPORT / PGUSER  server to use (must be able to CREATE DATABASE;
#                             the role must be a superuser so pgTAP can load)
#   PGTAP_SQL                 path to a generated pgtap.sql (required)
#   KEEP_DB=1                 do not drop the scratch database afterwards
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
db="${DB_NAME:-pigoowa_test_$$}"
: "${PGTAP_SQL:?set PGTAP_SQL to the path of a generated pgtap.sql}"

psql_base=(psql -X -v ON_ERROR_STOP=1 -q)

cleanup() {
  if [[ -z "${KEEP_DB:-}" ]]; then
    "${psql_base[@]}" -d postgres -c "drop database if exists \"$db\"" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

"${psql_base[@]}" -d postgres -c "drop database if exists \"$db\"" -c "create database \"$db\"" >/dev/null

"${psql_base[@]}" -d "$db" -f "$root/scripts/db/supabase-emulation.sql"
for f in "$root"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  "${psql_base[@]}" -d "$db" -f "$f"
done
"${psql_base[@]}" -d "$db" -f "$root/supabase/seed.sql"

# pgTAP is installed into the `extensions` schema, like on Supabase.
"${psql_base[@]}" -d "$db" -c "set search_path = extensions, public" -f "$PGTAP_SQL" >/dev/null 2>&1 \
  || { echo "pgTAP install failed" >&2; exit 2; }
"${psql_base[@]}" -d "$db" -c "alter database \"$db\" set search_path = public, extensions" >/dev/null

failed=0
total=0
for t in "$root"/supabase/tests/database/*.sql; do
  [[ -e "$t" ]] || continue
  out="$("${psql_base[@]}" -d "$db" -t -A -f "$t" 2>&1)" || { echo "$out"; echo "FAILED TO RUN: $t"; failed=1; continue; }
  n_ok=$(grep -c '^ok ' <<<"$out" || true)
  n_not=$(grep -c '^not ok ' <<<"$out" || true)
  total=$((total + n_ok + n_not))
  echo "$(basename "$t"): $n_ok ok, $n_not not ok"
  if [[ "$n_not" -gt 0 || -z "$(grep -E '^1\.\.[0-9]+' <<<"$out")" ]] || grep -qE '^# Looks like|^# Failed' <<<"$out"; then
    echo "$out" | grep -vE '^ok ' || true
    failed=1
  fi
done
echo "total assertions: $total"
exit "$failed"
