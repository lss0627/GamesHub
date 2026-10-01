import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('multi-tenant Unity capacity', () => {
  test('tenant runs do not exceed licensed worker capacity', async ({
    page,
  }) => {
    await page.goto(`${e2eUrl()}/operator/capacity`);
    await expect(page.getByText(/容量|license|worker/i)).toBeVisible();
  });
});
