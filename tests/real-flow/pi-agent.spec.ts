import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('Python-hosted official Pi drives discussion, confirmed Unity tools and playable result', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires real model and Unity',
  );
  test.setTimeout(25 * 60 * 1000);
  await mkdir('artifacts/pi-agent', { recursive: true });
  const health = await (
    await request.get('http://127.0.0.1:3001/health')
  ).json();
  expect(health.services.agent).toMatchObject({
    status: 'ready',
    runtime: 'pi-agent-core',
    controller: 'python',
  });
  const created = await request.post('/v1/projects', {
    data: { name: 'Pi 星光工坊' },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const evidence: Record<string, unknown> = {
    status: 'running',
    projectId: project.id,
    runtime: health.services.agent,
  };
  const save = () =>
    writeFile(
      'artifacts/pi-agent/browser-flow.json',
      JSON.stringify(evidence, null, 2),
    );
  await save();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/projects/${project.id}`);
  async function discuss(message: string) {
    const input = page.getByLabel('和 AI 讨论你的游戏');
    await expect(input).toBeEnabled({ timeout: 30000 });
    await input.fill(message);
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/messages'),
      { timeout: 155000 },
    );
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await discuss(
    '我是小白，想做点击成长游戏，名字星光工坊。点击收集星光，购买升级增加点击和自动收益，用现有内置素材，先教我怎么玩，不要开始制作。',
  );
  const draft = await discuss(
    '确认第一版：60秒内获得300资源，每次点击10、强化初价30、初始自动收益0。没有移动战斗或新美术。就按这个方案，先整理说明让我确认。',
  );
  expect(draft.brief.genre).toBe('clicker');
  expect(
    (await (await request.get(`/v1/projects/${project.id}/runs`)).json()).items,
  ).toHaveLength(0);
  evidence.brief = draft.brief;
  await page.getByRole('button', { name: '玩法与方案', exact: true }).click();
  const prepared = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.url().endsWith('/design/prepare'),
  );
  await page
    .getByRole('button', { name: '方案聊好了，生成制作说明 →', exact: true })
    .click();
  expect((await prepared).ok()).toBe(true);
  await page.screenshot({
    path: 'artifacts/pi-agent/confirmed-spec.png',
    fullPage: true,
  });
  const accepted = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.url().endsWith('/design/confirm'),
  );
  await page
    .getByRole('button', { name: '确认说明，开始制作 →', exact: true })
    .click();
  const response = await accepted;
  expect(response.ok(), await response.text()).toBe(true);
  const runId = (await response.json()).confirmedRunId;
  evidence.runId = runId;
  await save();
  let run: { id: string; status: string; result_summary: string };
  let previous = '';
  for (;;) {
    run = await (
      await request.get(`/v1/projects/${project.id}/runs/${runId}`)
    ).json();
    if (run.status !== previous) console.log(`PI RUN ${runId} ${run.status}`);
    previous = run.status;
    if (
      [
        'succeeded',
        'failed',
        'cancelled',
        'timed_out',
        'partially_succeeded',
        'out_of_scope',
        'rejected',
      ].includes(run.status)
    )
      break;
    await page.waitForTimeout(4000);
  }
  evidence.run = run;
  const events = await (
    await request.get(`/v1/projects/${project.id}/runs/${runId}/events`)
  ).text();
  evidence.events = events;
  await save();
  expect(run.status, JSON.stringify(run)).toBe('succeeded');
  expect(JSON.stringify(events)).toContain('pi-agent-core');
  expect(JSON.stringify(events)).toContain('execute_action');
  const game = await context.newPage();
  await game.setViewportSize({ width: 960, height: 600 });
  await game.goto(run.result_summary);
  const state = () =>
    game.evaluate(
      () =>
        (
          window as unknown as {
            __gamerhubGameState: {
              runtime: string;
              phase: string;
              perClick: number;
              autoIncome: number;
              total: number;
            };
          }
        ).__gamerhubGameState,
    );
  await expect
    .poll(async () => (await state())?.runtime, { timeout: 150000 })
    .toBe('clicker-v1');
  await game.mouse.click(480, 483);
  await expect.poll(async () => (await state()).phase).toBe('playing');
  for (let i = 0; i < 3; i++) {
    await game.mouse.click(510, 411, { delay: 50 });
    await game.waitForTimeout(100);
  }
  await game.mouse.click(775, 411);
  await expect.poll(async () => (await state()).perClick).toBe(20);
  expect((await state()).autoIncome).toBe(2);
  for (let i = 0; i < 20 && (await state()).phase === 'playing'; i++) {
    await game.mouse.click(510, 411, { delay: 50 });
    await game.waitForTimeout(100);
  }
  await expect.poll(async () => (await state()).phase).toBe('won');
  evidence.gameplay = await state();
  await game.screenshot({ path: 'artifacts/pi-agent/game-won.png' });
  await page.reload();
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await page.locator('iframe[title="游戏预览"]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'artifacts/pi-agent/studio.png',
    fullPage: true,
  });
  evidence.status = 'passed';
  await save();
});
