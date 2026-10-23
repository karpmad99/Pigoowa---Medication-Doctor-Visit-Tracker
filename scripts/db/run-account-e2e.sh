#!/usr/bin/env bash
# Runs the end-to-end tests of the build with accounts (e2e-accounts/) against the LOCAL Supabase stack.
# Needs `supabase start` already running. Reads only the API URL and the PUBLIC (anon) key from
# `supabase status`; the service-role / secret key is never read, exported or used.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

status="$(supabase status -o env)"
VITE_SUPABASE_URL="$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$status")"
VITE_SUPABASE_ANON_KEY="$(sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' <<<"$status")"
unset status
if [[ -z "$VITE_SUPABASE_URL" || -z "$VITE_SUPABASE_ANON_KEY" ]]; then
  echo "supabase status gave no API_URL / ANON_KEY: is the local stack running (supabase start)?" >&2
  exit 2
fi
export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY

exec npx playwright test --config playwright.accounts.config.ts "$@"
