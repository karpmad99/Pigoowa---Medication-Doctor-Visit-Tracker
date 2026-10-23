import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const REQUEST_TIMEOUT_MS = 20_000;

/** The Supabase client of this application, typed with the generated schema (`npm run db:types`). */
export type PigoowaClient = SupabaseClient<Database>;

/**
 * The browser's Supabase client. It is made with the PUBLIC key only (src/lib/config.ts refuses a secret
 * one), so everything it can do is decided by the signed-in user's session and by Row Level Security.
 * The session is kept by supabase-js in this browser's localStorage under its own `sb-…-auth-token` key
 * and refreshed before it expires; the application's own keys (`pigoowa:…`) are never touched by it.
 */
export function createPigoowaClient(
  config: { supabaseUrl: string; supabaseAnonKey: string },
  options: { retryReads?: boolean } = {},
): PigoowaClient {
  return createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    db: {
      // supabase-js can repeat a read that failed for lack of a connection (1 s, 2 s, 4 s apart). Off by
      // default: a person who is offline should see the error at once, with a button to try again, not a spinner
      // for seven seconds. Writes are never repeated. A request that gets no answer at all is abandoned after
      // this long, so a dead connection cannot keep a spinner on the screen for ever.
      retry: options.retryReads ?? false,
      timeout: REQUEST_TIMEOUT_MS,
    },
  });
}
