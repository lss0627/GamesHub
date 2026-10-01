import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'artifacts/ui-logic-tests',
  use: {
    baseURL: process.env.GAMERHUB_UI_TEST_URL ?? 'http://127.0.0.1:3100',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  webServer: process.env.GAMERHUB_UI_TEST_URL
    ? undefined
    : {
        command: 'pnpm --filter @gamerhub/studio-web exec next dev --port 3100',
        url: 'http://127.0.0.1:3100',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
