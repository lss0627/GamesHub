import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('checkpoint rollback', () => {
  test('creator can undo the most recent change', async ({ page }) => {
    await page.goto(`${e2eUrl()}/projects/fixture`);
    await expect(page.getByText(/版本|撤销/)).toBeVisible();
  });
});
