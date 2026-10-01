import {
  buildDesignSpec,
  type DesignDocument,
  designMarkdown,
  initialBrief,
} from '../../packages/game-spec/src/index';
import { expect, type Page, test } from './fixtures';

async function workspace(page: Page, initialStatus?: string) {
  let document: DesignDocument = {
    revision: 0,
    brief: { ...initialBrief },
    messages: [],
    choices: ['我想做一个轻松的猫咪跑酷'],
  };
  let confirms = 0;
  let polls = 0;
  let failOnce = false;
  let failMessage = false;
  let unsupported = false;
  let status = initialStatus;
  const preview = 'https://preview.example/verified';
  await page.route('https://preview.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Verified game</p>' }),
  );
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      route.request().method() === 'POST'
        ? route.request().postDataJSON()
        : undefined;
    if (path.endsWith('/design/messages')) {
      if (failMessage) {
        failMessage = false;
        return route.fulfill({
          status: 502,
          json: { code: 'DESIGN_MODEL_INVALID' },
        });
      }
      document = {
        revision: document.revision + 1,
        creationMode: body.creationMode ?? 'discuss',
        brief: {
          ...initialBrief,
          ...(unsupported ? { genre: 'custom' as const } : {}),
        },
        choices: ['60秒就好'],
        messages: [
          ...document.messages,
          { role: 'user', content: body.message },
          {
            role: 'assistant',
            content: '好的，我们先确定难度和一局时长。你希望一局60秒吗？',
          },
        ],
      };
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/design/prepare')) {
      document = {
        ...document,
        revision: document.revision + 1,
        spec: buildDesignSpec(document.brief),
        markdown: designMarkdown(document.brief),
      };
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/design/confirm')) {
      confirms++;
      status = 'queued';
      document = {
        ...document,
        revision: document.revision + 1,
        confirmedRunId: 'new-run',
      };
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/design')) return route.fulfill({ json: document });
    if (path.endsWith('/runs')) {
      polls++;
      if (failOnce) {
        failOnce = false;
        return route.abort('failed');
      }
      return route.fulfill({
        json: {
          items: status
            ? [
                {
                  id: 'verified-run',
                  status: 'succeeded',
                  result_summary: preview,
                },
                {
                  id: 'new-run',
                  status,
                  result_summary: status === 'failed' ? 'BUILD_FAILED' : null,
                },
              ]
            : [],
        },
      });
    }
    if (path.endsWith('/cancel')) {
      status = 'cancelled';
      return route.fulfill({ json: { id: 'new-run', status } });
    }
    if (path.endsWith('/assets') || path.endsWith('/versions'))
      return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { id: 'project-1' } });
  });
  return {
    confirms: () => confirms,
    polls: () => polls,
    failNextPoll: () => {
      failOnce = true;
    },
    failNextMessage: () => {
      failMessage = true;
    },
    unsupportedIdea: () => {
      unsupported = true;
    },
    failRun: () => {
      status = 'failed';
    },
    draft: () => document,
  };
}

test('discussion survives reload; only explicit confirmation starts production', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto('/projects/project-1');
  const input = page.getByLabel('和 AI 讨论你的游戏');
  const prepare = page.getByRole('button', {
    name: '方案聊好了，生成制作说明',
  });
  await expect(prepare).toBeDisabled();
  await input.fill('我喜欢轻松的游戏');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(
    page.getByText('我喜欢轻松的游戏', { exact: true }),
  ).toBeVisible();
  await expect(prepare).toBeEnabled();
  await page.reload();
  await expect(
    page.getByText('我喜欢轻松的游戏', { exact: true }),
  ).toBeVisible();
  await input.fill('60秒，慢一点');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(
    page.getByRole('region', { name: '制作说明 Spec' }),
  ).toContainText('制作与验收');
  expect(state.confirms()).toBe(0);
  await page.getByRole('button', { name: '确认说明，开始制作' }).click();
  await expect(page.getByText('正在按你确认的说明制作与检查')).toBeVisible();
  expect(state.confirms()).toBe(1);
  await expect(input).toBeDisabled();
});

test('failed AI replies retain the input and never start production', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto('/projects/project-1');
  state.failNextMessage();
  const input = page.getByLabel('和 AI 讨论你的游戏');
  await input.fill('我想讨论操作方式');
  await page.getByRole('button', { name: '发送 ↑' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '没有给出完整方案' }),
  ).toBeVisible();
  await expect(input).toHaveValue('我想讨论操作方式');
  expect(state.confirms()).toBe(0);
  expect(state.draft().messages).toHaveLength(0);
});

test('one sentence explicitly starts one production run and preserves the generated specification', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '一句话制作', exact: true }).click();
  await page.getByLabel('和 AI 讨论你的游戏').fill('做一个轻松的猫咪跑酷游戏');
  await page.getByRole('button', { name: '直接制作 →', exact: true }).click();
  await expect.poll(state.confirms).toBe(1);
  expect(
    state.draft().messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1);
  expect(state.draft().spec).toBeDefined();
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect(page.getByText('正在按你确认的说明制作与检查')).toBeVisible();
  expect(state.confirms()).toBe(1);
});

test('one-sentence model failure retains the idea without starting production', async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '一句话制作', exact: true }).click();
  state.failNextMessage();
  const input = page.getByLabel('和 AI 讨论你的游戏');
  await input.fill('做一个轻松的点击成长游戏');
  await page.getByRole('button', { name: '直接制作 →', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '没有给出完整方案' }),
  ).toBeVisible();
  await expect(input).toHaveValue('做一个轻松的点击成长游戏');
  expect(state.confirms()).toBe(0);
});

test('one-sentence unsupported idea stays a design without admitting a different game', async ({
  page,
}) => {
  const state = await workspace(page);
  state.unsupportedIdea();
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '一句话制作', exact: true }).click();
  await page.getByLabel('和 AI 讨论你的游戏').fill('制作一个多人开放世界游戏');
  await page.getByRole('button', { name: '直接制作 →', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '未接入的制作能力' }),
  ).toBeVisible();
  expect(state.confirms()).toBe(0);
  expect(state.draft().spec?.game.genre).toBe('custom');
  await expect(
    page.getByRole('button', { name: '确认说明，开始制作 →', exact: true }),
  ).toBeDisabled();
});

test('active work reconnects and retains the last playable build after failure', async ({
  page,
}) => {
  const state = await workspace(page, 'executing');
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '试玩游戏' }).click();
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeDisabled();
  await expect(page.getByRole('link', { name: '大窗口试玩' })).toHaveAttribute(
    'href',
    'https://preview.example/verified',
  );
  state.failNextPoll();
  const before = state.polls();
  await expect
    .poll(state.polls, { timeout: 10_000 })
    .toBeGreaterThan(before + 1);
  state.failRun();
  await expect(
    page.getByText('这次制作没有完成。', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeEnabled();
  await expect(page.getByRole('link', { name: '大窗口试玩' })).toHaveAttribute(
    'href',
    'https://preview.example/verified',
  );
});

test('mobile workbench shows actual built-in art without horizontal overflow', async ({
  page,
}) => {
  await workspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '角色与素材' }).click();
  for (const name of ['围巾橘猫', '晨光森林', '星星金币', '森林木桩']) {
    const img = page.getByRole('img', { name, exact: true });
    await expect(img).toBeVisible();
    await expect
      .poll(() =>
        img.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'artifacts/guided-flow/mobile-workbench.png',
    fullPage: true,
  });
});
