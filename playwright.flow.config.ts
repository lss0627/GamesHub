import { defineConfig, devices } from '@playwright/test';
import { loadEnvironmentFile } from './scripts/dev-env';

loadEnvironmentFile();
export default defineConfig({
  testDir: './tests/real-flow',
  timeout: 30 * 60 * 1000,
  workers: 1,
  retries: 0,
  outputDir: 'artifacts/real-flow/results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/real-flow/playwright.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
