import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:3000',
    // Optional: reuse a system Chromium instead of `playwright install`.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  webServer: { command: 'pnpm start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
});
