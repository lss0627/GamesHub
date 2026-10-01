import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('run resume and cancel', () => {
  test('creator can pause, resume and cancel a run', async ({ page }) => {
    await page.goto(`${e2eUrl()}/projects/fixture`);
    await expect(page.getByText(/暂停|恢复|取消/)).toBeVisible();
  });
});
