import { defineConfig, devices } from '@playwright/test';

// Not a test run: `npm run screenshots` regenerates docs/screenshots from the FICTIONAL demo data
// (fixed clock, fixed time zone), so the images in the README are reproducible.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './screenshots',
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
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
    reuseExistingServer: true,
  },
});
