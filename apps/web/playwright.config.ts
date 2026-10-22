import { defineConfig } from '@playwright/test';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL es obligatorio para las pruebas E2E');

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    // Optional: reuse a system Chromium instead of `playwright install`.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  webServer: [
    {
      command: 'pnpm --filter @ee/api start',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL,
        NODE_ENV: 'test',
        API_PORT: '4000',
        WEB_ORIGIN: 'http://localhost:3000',
        ALLOWED_GOOGLE_DOMAINS: 'e2e.example',
        SESSION_SECRET: 'e2e-only-session-secret-0123456789abcdef',
      },
    },
    { command: 'pnpm start', url: 'http://localhost:3000/login', reuseExistingServer: !process.env.CI },
  ],
});
