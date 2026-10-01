import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/proxy',
  timeout: 75_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'artifacts/proxy-regression',
  use: { baseURL: 'http://127.0.0.1:3200', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'pnpm --filter @gamerhub/studio-web exec next dev --port 3200',
    env: { GAMERHUB_API_URL: 'http://127.0.0.1:3301' },
    url: 'http://127.0.0.1:3200',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
