import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, acceptDownloads: true },
  webServer: { command: 'npm run dev', port: 4173, reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
