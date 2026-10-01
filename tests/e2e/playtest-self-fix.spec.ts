import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('playtest self-fix', () => {
  test('creator sees a bounded self-fix outcome', async ({ page }) => {
    await page.goto(`${e2eUrl()}/projects/fixture`);
    await expect(page.getByText(/修复|完成|需要处理/)).toBeVisible();
  });
});
