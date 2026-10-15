import { defineConfig, devices } from '@playwright/test';

// Optional: use an already-installed Chromium instead of the one Playwright downloads.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  // No retries: a test that only passes on the second try is a flaky test we want to see.
  retries: 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
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
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !isCI,
  },
});
