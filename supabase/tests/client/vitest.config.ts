import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// The integration tests against a running LOCAL Supabase stack. They are not part of `npm test` (that
// one runs `src/**` only and needs no services): run them with `npm run test:db-client`, which reads the
// URL and the public key from `supabase status`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['supabase/tests/client/**/*.test.ts'],
    // The files share one local database; each makes its own users, but they run one after another so
    // that the sign-up rate limit of the local Auth server is not hit by parallel workers.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
