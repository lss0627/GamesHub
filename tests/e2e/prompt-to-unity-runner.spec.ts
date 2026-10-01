import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('prompt to Unity Runner', () => {
  test('prompt creates a playable runner preview', async ({ page }) => {
    await page.goto(`${e2eUrl()}/`);
    await expect(
      page.getByRole('heading', { name: /GamerHub/i }),
    ).toBeVisible();
    await page
      .getByLabel('游戏描述')
      .fill('做一个可以跳跃、躲避障碍物、收集金币的猫咪跑酷游戏。');
    await page.getByRole('button', { name: /开始创作/ }).click();
    await expect(page.getByText(/正在测试|可试玩/)).toBeVisible({
      timeout: 900_000,
    });
    await expect(page.locator('iframe[title="游戏预览"]')).toBeVisible();
  });
});
