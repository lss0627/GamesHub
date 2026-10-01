import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('Unity Web browser matrix', () => {
  for (const browserName of ['chromium', 'firefox', 'webkit']) {
    test(`${browserName} loads an isolated preview`, async ({
      page,
      browserName: actual,
    }) => {
      test.skip(actual !== browserName, `run under ${browserName}`);
      await page.goto(`${e2eUrl()}/projects/fixture`);
      await expect(page.getByText(/预览|游戏/)).toBeVisible();
    });
  }
});
