#!/usr/bin/env bash
# Runs the two-session isolation test (supabase/tests/client/isolation.test.ts) against the LOCAL stack.
# Needs: `supabase start` already running. Reads only the URL and the public (anon) key from
# `supabase status`; the service-role key is never read, exported or used.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

status="$(supabase status -o env)"
SUPABASE_URL="$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$status")"
SUPABASE_ANON_KEY="$(sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' <<<"$status")"
unset status
if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
  echo "supabase status gave no API_URL / ANON_KEY: is the local stack running (supabase start)?" >&2
  exit 2
fi
export SUPABASE_URL SUPABASE_ANON_KEY

exec npx vitest run --config supabase/tests/client/vitest.config.ts
