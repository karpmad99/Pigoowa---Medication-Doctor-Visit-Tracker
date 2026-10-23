#!/usr/bin/env bash
# Builds the app with the PUBLIC variables of the local stack and checks the bundle holds no other key.
# Needs `supabase start` already running. Only the API URL and the public (anon) key are read.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

status="$(supabase status -o env)"
VITE_SUPABASE_URL="$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$status")"
VITE_SUPABASE_ANON_KEY="$(sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' <<<"$status")"
unset status
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
exec node scripts/db/check-account-bundle.mjs
