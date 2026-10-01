import { expect, readyHealth, test } from './fixtures';

test('missing Unity explains one-click integration without blocking discussion', async ({
  page,
}) => {
  await page.route('**/api/gamerhub/health', (route) =>
    route.fulfill({
      status: 503,
      json: {
        ...readyHealth,
        status: 'blocked',
        creationReady: false,
        services: {
          ...readyHealth.services,
          unity: { status: 'blocked', code: 'UNITY_WEB_MODULE_NOT_FOUND' },
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('region', { name: '创作环境' })).toContainText(
    '网页导出组件还没准备好',
  );
  await expect(page.getByRole('region', { name: '创作环境' })).toContainText(
    '启动GamerHub.cmd',
  );
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeEnabled();
});
test('offline readiness recovers without claiming that Unity license is verified', async ({
  page,
}) => {
  let online = false;
  await page.route('**/api/gamerhub/health', (route) =>
    online
      ? route.fulfill({ json: readyHealth })
      : route.fulfill({ status: 502, body: 'Internal Server Error' }),
  );
  await page.goto('/');
  await expect(page.getByRole('region', { name: '创作环境' })).toContainText(
    '创作服务还没连接上',
  );
  online = true;
  await page.getByRole('button', { name: '重新检查环境' }).click();
  await expect(page.getByRole('region', { name: '创作环境' })).toContainText(
    '创作环境已连接',
  );
  await expect(page.getByRole('region', { name: '创作环境' })).toContainText(
    '首次制作时检查许可',
  );
});
