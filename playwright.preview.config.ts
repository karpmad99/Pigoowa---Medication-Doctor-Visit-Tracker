import { defineConfig, devices } from '@playwright/test';

// Checks the production build as a static host serves it (`vite preview`), not the dev server.
// Run with `npm run e2e:preview`; it builds first.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e-preview',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
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
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
