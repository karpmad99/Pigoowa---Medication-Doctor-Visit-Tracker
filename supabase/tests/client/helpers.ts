import { randomUUID } from 'node:crypto';
import { createPigoowaClient } from '@/services/supabase/client';
import type { PigoowaClient } from '@/services/supabase/client';

// Shared by the integration tests against the LOCAL stack. Only the public URL and key are used.

export const url = process.env.SUPABASE_URL ?? '';
export const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

export function requireStack(): void {
  if (url === '' || anonKey === '') {
    throw new Error(
      'SUPABASE_URL and SUPABASE_ANON_KEY are required: run `npm run test:db-client`.',
    );
  }
}

/** A client the way the browser makes it, but without a stored session (there is no browser here). */
export function newClient(
  options: { retryReads?: boolean } = { retryReads: false },
): PigoowaClient {
  const client = createPigoowaClient({ supabaseUrl: url, supabaseAnonKey: anonKey }, options);
  return client;
}

export function newCredentials(label: string): { email: string; password: string } {
  return {
    email: `pigoowa-${label}-${randomUUID()}@example.com`,
    password: randomUUID() + randomUUID(),
  };
}
