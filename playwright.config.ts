import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'evidence/playwright-report', open: 'never' }],
    ['json', { outputFile: 'evidence/playwright-results.json' }],
  ],
  outputDir: 'evidence/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'es-BO',
    timezoneId: 'America/La_Paz',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chrome-1366x768', use: { channel: 'chrome', viewport: { width: 1366, height: 768 } } },
    { name: 'chrome-1920x1080', use: { channel: 'chrome', viewport: { width: 1920, height: 1080 } } },
    { name: 'edge-1366x768', use: { channel: 'msedge', viewport: { width: 1366, height: 768 } } },
    { name: 'edge-1920x1080', use: { channel: 'msedge', viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: 'npm run demo',
    url: 'http://127.0.0.1:4173/__health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
