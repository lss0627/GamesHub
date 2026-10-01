import {
  buildDesignSpec,
  designMarkdown,
  initialBrief,
} from '../../packages/game-spec/src';
import { expect, test } from './fixtures';

for (const genre of ['survivor', 'tower_defense', 'custom'] as const) {
  test(`${genre} shows matching guidance and honest execution availability`, async ({
    page,
  }) => {
    const brief = {
      ...initialBrief,
      genre,
      name: genre === 'survivor' ? '星灯幸存者' : '我的塔防',
    };
    const document = {
      revision: 2,
      brief,
      messages: [{ role: 'user', content: '我的游戏' }],
      choices: [],
      spec: buildDesignSpec(brief),
      markdown: designMarkdown(brief),
    };
    await page.route('**/v1/**', (route) =>
      route.fulfill({
        json: route.request().url().endsWith('/design')
          ? document
          : { items: [] },
      }),
    );
    await page.goto('/projects/00000000-0000-4000-8000-000000000001');
    await expect(
      page.getByRole('heading', { name: brief.name, exact: true }),
    ).toBeVisible();
    const confirm = page.getByRole('button', {
      name: '确认说明，开始制作 →',
      exact: true,
    });
    if (genre !== 'custom') {
      await expect(
        page.getByText(
          genre === 'survivor' ? '幸存者操作指南' : '塔防操作指南',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(confirm).toBeEnabled();
    } else {
      await expect(
        page.getByText(/尚未接入可执行玩法模块/).first(),
      ).toBeVisible();
      await expect(confirm).toBeDisabled();
    }
  });
}
