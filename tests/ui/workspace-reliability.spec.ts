import {
  buildDesignSpec,
  type DesignDocument,
  initialBrief,
} from '../../packages/game-spec/src/index';
import { expect, type Page, test } from './fixtures';

async function mockWorkspace(page: Page) {
  let status: string | undefined;
  let assetFailure = false;
  let document: DesignDocument = {
    revision: 0,
    brief: { ...initialBrief },
    choices: [],
    messages: [
      { role: 'user', content: '猫咪跑酷' },
      { role: 'assistant', content: '一起设计' },
      { role: 'user', content: '轻松一点' },
    ],
  };
  let hold = false;
  let release: (() => void) | undefined;
  let held = false;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/runs')) {
      const items = status
        ? [{ id: 'run', status, request_type: 'modify' }]
        : [];
      if (hold) {
        hold = false;
        held = true;
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return route.fulfill({ json: { items } });
    }
    if (path.endsWith('/assets'))
      return route.fulfill({
        status: assetFailure ? 503 : 200,
        json: assetFailure ? { code: 'UNAVAILABLE' } : { items: [] },
      });
    if (path.endsWith('/versions'))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/events'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'id: 1\nevent: agent.act.started\ndata: {"sequence":1,"type":"agent.act.started","payload":{"actionId":"build-web"}}\n\n',
      });
    if (path.endsWith('/pause')) {
      status = 'paused';
      return route.fulfill({ status: 202, json: { id: 'run', status } });
    }
    if (path.endsWith('/resume')) {
      status = 'executing';
      return route.fulfill({ status: 202, json: { id: 'run', status } });
    }
    if (path.endsWith('/cancel')) {
      status = 'cancel_requested';
      return route.fulfill({ status: 202, json: { id: 'run', status } });
    }
    if (path.endsWith('/design/prepare')) {
      document = {
        ...document,
        revision: document.revision + 1,
        spec: buildDesignSpec(document.brief),
        markdown: '制作说明',
      };
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/design/confirm')) {
      status = 'queued';
      document = {
        ...document,
        revision: document.revision + 1,
        confirmedRunId: 'run',
      };
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/design')) return route.fulfill({ json: document });
    return route.fulfill({
      json: {
        id: 'reliable-project',
        revision: 0,
        status: 'empty',
        candidates: [],
        requirements: [],
      },
    });
  });
  return {
    setStatus: (value: string) => {
      status = value;
    },
    setAssetFailure: (value: boolean) => {
      assetFailure = value;
    },
    updateDesign: () => {
      document = {
        ...document,
        revision: document.revision + 1,
        messages: [
          ...document.messages,
          { role: 'assistant', content: '另一页已经更新了方案' },
        ],
      };
    },
    hold: () => {
      hold = true;
    },
    held: () => held,
    release: () => release?.(),
  };
}

test('asset failure never freezes run state and connection warning recovers', async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.setStatus('executing');
  state.setAssetFailure(true);
  await page.goto('/projects/reliable-project');
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeDisabled();
  await expect(
    page.getByRole('status').filter({ hasText: '素材暂时未同步' }),
  ).toBeVisible();
  state.setStatus('failed');
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeEnabled({
    timeout: 10000,
  });
  state.setAssetFailure(false);
  await expect(page.getByText('素材暂时未同步', { exact: false })).toHaveCount(
    0,
    { timeout: 10000 },
  );
});

test('unsent text survives reload while newer discussion syncs independently', async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto('/projects/reliable-project');
  const input = page.getByLabel('和 AI 讨论你的游戏');
  await input.fill('还没发送的玩法想法');
  await page.reload();
  await expect(input).toHaveValue('还没发送的玩法想法');
  state.updateDesign();
  await expect(
    page.getByText('另一页已经更新了方案', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(input).toHaveValue('还没发送的玩法想法');
});

test('an old poll cannot overwrite an explicitly confirmed queued run', async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto('/projects/reliable-project');
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeEnabled();
  state.hold();
  await expect.poll(state.held, { timeout: 10000 }).toBe(true);
  await page.getByRole('button', { name: '方案聊好了，生成制作说明' }).click();
  await page.getByRole('button', { name: '确认说明，开始制作 →' }).click();
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeDisabled();
  state.release();
  await page.waitForTimeout(300);
  await expect(page.getByLabel('和 AI 讨论你的游戏')).toBeDisabled();
});

test('real agent steps and pause/resume controls explain the safe boundary', async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.setStatus('executing');
  await page.goto('/projects/reliable-project');
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Agent 制作步骤' }),
  ).toContainText('构建网页游戏');
  await page.getByRole('button', { name: '暂停制作', exact: true }).click();
  await expect(page.getByText('制作已暂停', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续制作', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '暂停制作', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(
    page.getByText('正在停止，等待当前 Unity 操作结束', { exact: true }),
  ).toBeVisible();
  state.setStatus('cancelled');
  await expect(
    page.getByRole('region', { name: 'Agent 制作步骤' }),
  ).toContainText('本次制作已停止', { timeout: 10000 });
  await expect(
    page.getByRole('region', { name: 'Agent 制作步骤' }),
  ).not.toContainText('正在处理');
});
