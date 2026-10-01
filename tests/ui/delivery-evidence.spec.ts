import { initialBrief } from '../../packages/game-spec/src';
import { expect, test } from './fixtures';

for (const scenario of ['verified', 'legacy', 'failed'] as const) {
  test(`workbench shows ${scenario} delivery with honest evidence`, async ({
    page,
  }) => {
    const status = scenario === 'failed' ? 'failed' : 'succeeded';
    const payload = {
      runId: 'run',
      specVersionId: 'spec',
      buildHash: 'build',
      previewId: 'preview',
      tests: [
        {
          mode: 'indexed',
          criteria: [
            {
              id: 'reward.01',
              description: '旧奖励入口不再发放资源',
              status: 'passed',
            },
          ],
        },
      ],
      browser: {
        passed: true,
        checks: [{ id: 'core-interaction', status: 'passed' }],
      },
    };
    const events =
      scenario === 'legacy'
        ? []
        : [
            { sequence: 1, type: 'run.delivery.prepared', payload },
            scenario === 'verified'
              ? {
                  sequence: 2,
                  type: 'run.succeeded',
                  payload: { specVersionId: 'spec', previewId: 'preview' },
                }
              : {
                  sequence: 2,
                  type: 'run.source.recovered',
                  payload: { archived: true },
                },
          ];
    await page.route('**/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/events'))
        return route.fulfill({
          contentType: 'text/event-stream',
          body: events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(''),
        });
      if (path.endsWith('/runs'))
        return route.fulfill({
          json: { items: [{ id: 'run', status, request_type: 'modify' }] },
        });
      if (path.endsWith('/versions') || path.endsWith('/assets'))
        return route.fulfill({ json: { items: [] } });
      if (path.endsWith('/design'))
        return route.fulfill({
          json: { revision: 0, brief: initialBrief, choices: [], messages: [] },
        });
      return route.fulfill({
        json: {
          id: 'delivery-project',
          name: '交付验收',
          revision: 0,
          items: [],
          requirements: [],
          candidates: [],
          status: 'empty',
        },
      });
    });
    await page.goto('/projects/delivery-project');
    await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
    const delivery = page.getByRole('region', { name: '交付验收' });
    if (scenario === 'verified') {
      await expect(
        delivery.getByRole('heading', { name: '本次交付已通过验证' }),
      ).toBeVisible();
      await delivery.getByText('查看浏览器与需求验收', { exact: true }).click();
      await expect(
        delivery.getByText('✓ 旧奖励入口不再发放资源 · 通过'),
      ).toBeVisible();
    } else {
      await expect(
        delivery.getByRole('heading', { name: '本次交付已通过验证' }),
      ).toHaveCount(0);
      await expect(
        delivery.getByRole('heading', {
          name:
            scenario === 'legacy'
              ? '此版本暂无完整验收记录'
              : '本次未交付新版本',
        }),
      ).toBeVisible();
      if (scenario === 'failed')
        await expect(
          delivery.getByText('本次未完成的源码已归档，工程已恢复到制作前。'),
        ).toBeVisible();
    }
  });
}
