import { defineConfig, devices } from '@playwright/test';
import { loadEnvironmentFile } from './scripts/dev-env';

loadEnvironmentFile();

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'artifacts/playwright.json' }]],
  use: {
    baseURL:
      process.env.GAMERHUB_E2E_URL ??
      process.env.STUDIO_URL ??
      'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
