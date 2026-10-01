import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('local jump modification', () => {
  test('creator can request a local jump-height modification', async ({
    page,
  }) => {
    await page.goto(`${e2eUrl()}/projects/fixture`);
    await page.getByLabel('游戏描述').fill('把跳跃高度改成 5');
    await page.getByRole('button', { name: /开始创作|开始创建/ }).click();
    await expect(page.getByText(/局部|修改|预览/)).toBeVisible();
  });
});
