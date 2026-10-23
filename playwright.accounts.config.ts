import { defineConfig, devices } from '@playwright/test';

// The end-to-end tests of the build WITH accounts, against a real LOCAL Supabase stack (`supabase start`).
// Run them with `npm run e2e:accounts` (scripts/db/run-account-e2e.sh): it reads the API URL and the PUBLIC
// key from `supabase status` and hands them to the dev server below. The secret/service-role key is never read.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required: run `npm run e2e:accounts`.',
  );
}

export default defineConfig({
  testDir: './e2e-accounts',
  // One database, one sign-up rate limit: the tests run one after another. Each makes its own accounts.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'retain-on-failure',
    timezoneId: 'Europe/Warsaw',
    locale: 'pl-PL',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  webServer: {
    // A dev server of its own, started with the two public variables; never reuse one that was not.
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
