import { expect, test } from '@playwright/test';
import { e2eUrl } from './runtime';

test.describe('replace character asset', () => {
  test('creator can upload and replace the player character', async ({
    page,
  }) => {
    await page.goto(`${e2eUrl()}/projects/fixture`);
    await expect(page.getByRole('heading', { name: '素材' })).toBeVisible();
    await page.getByLabel('我确认拥有素材授权').check();
    await page.getByLabel('选择素材').setInputFiles({
      name: 'cat.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await page.getByRole('button', { name: '上传素材' }).click();
    await expect(page.getByText(/等待安全检查|素材已上传/)).toBeVisible();
    await page.getByRole('button', { name: '应用到角色' }).click();
    await expect(page.getByText(/正在准备角色素材替换/)).toBeVisible();
  });
});
