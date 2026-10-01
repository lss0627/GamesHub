import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('real Pi develops a new reward mechanism, verifies behavior and retains source on revision', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires actual model, database and Unity',
  );
  test.setTimeout(45 * 60 * 1000);
  const directory = 'artifacts/gameplay-extensibility';
  await mkdir(directory, { recursive: true });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  const save = () =>
    writeFile(
      `${directory}/development-flow.json`,
      JSON.stringify(evidence, null, 2),
    );
  const existingId = process.env.GAMERHUB_DEVELOPMENT_PROJECT_ID;
  const created = existingId
    ? await request.get(`/v1/projects/${existingId}`)
    : await request.post('/v1/projects', {
        data: { name: '机制开发与保留验收' },
      });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  evidence.projectId = project.id;
  await save();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`/projects/${project.id}`);
  async function discuss(content: string) {
    await page.getByLabel('和 AI 讨论你的游戏').fill(content);
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
  const draft = existingId
    ? await (await request.get(`/v1/projects/${project.id}/design`)).json()
    : await discuss(
        '制作一个点击成长原型，名称“星灯奖励工坊”，60秒目标300，每次点击10，升级初价30，初始自动收益0，使用现有素材。明确增加一个需要开发的新机制：奖励领取。游戏开始后按B或点击新增“领取奖励 +20”按钮，总资源与钱包各加20，3秒有效游戏时间内不能重复领取；暂停、开始前和结算后不能领取，暂停冻结冷却，重新挑战重置冷却且可立即领取。请把这个需求安排为development机制，标识reward_burst，并给出真实行为验收。保留原有点击和购买升级功能；其他使用默认值。首版范围已经确定，先整理制作说明，不要扩充或改类型。',
      );
  evidence.brief = draft.brief;
  await save();
  expect(draft.brief.genre).toBe('clicker');
  expect(
    draft.brief.development?.some(
      (item: { id: string }) => item.id === 'reward_burst',
    ),
  ).toBe(true);
  expect(draft.brief.executionGaps ?? []).toEqual([]);
  await discuss(
    '确认首版范围和所有参数。保留 reward_burst 奖励机制、B键与按钮、20点收益、3秒有效游戏时间冷却、暂停和重开规则；保留原有普通点击与升级。请按此整理制作说明，不增加其他内容。',
  );
  async function prepareConfirm(label: string) {
    await page.getByRole('button', { name: '玩法与方案', exact: true }).click();
    let pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/prepare'),
    );
    await page
      .getByRole('button', { name: '方案聊好了，生成制作说明 →', exact: true })
      .click();
    let response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    evidence[`${label}Spec`] = (await response.json()).spec;
    await page.screenshot({
      path: `${directory}/${label}-spec.png`,
      fullPage: true,
    });
    pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/confirm'),
    );
    await page
      .getByRole('button', { name: '确认说明，开始制作 →', exact: true })
      .click();
    response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const id = (await response.json()).confirmedRunId;
    evidence[`${label}RunId`] = id;
    await save();
    let run: { id: string; status: string; result_summary: string };
    let previous = '';
    for (;;) {
      run = await (
        await request.get(`/v1/projects/${project.id}/runs/${id}`)
      ).json();
      if (run.status !== previous) console.log(`${label} ${id} ${run.status}`);
      previous = run.status;
      if (
        [
          'succeeded',
          'failed',
          'timed_out',
          'cancelled',
          'partially_succeeded',
          'rejected',
          'out_of_scope',
        ].includes(run.status)
      )
        break;
      await page.waitForTimeout(5000);
    }
    evidence[`${label}Run`] = run;
    const events = await (
      await request.get(`/v1/projects/${project.id}/runs/${id}/events`)
    ).text();
    await writeFile(`${directory}/${label}-events.txt`, events);
    await save();
    expect(run.status, JSON.stringify(run)).toBe('succeeded');
    return { run, events };
  }
  const first = await prepareConfirm('development');
  expect(first.events).toContain('workspace_write');
  expect(first.events).toContain('develop-reward_burst');
  async function play(url: string, label: string, perClick: number) {
    const game = await context.newPage();
    await game.setViewportSize({ width: 960, height: 600 });
    await game.goto(url);
    const state = () =>
      game.evaluate(
        () =>
          (
            window as unknown as {
              __gamerhubGameState: {
                phase: string;
                total: number;
                wallet: number;
                perClick: number;
              };
            }
          ).__gamerhubGameState,
      );
    await expect
      .poll(async () => (await state())?.phase, { timeout: 150000 })
      .toBe('ready');
    await game.keyboard.press('b');
    await game.waitForTimeout(200);
    expect((await state()).total).toBe(0);
    await game.mouse.click(480, 483);
    await expect.poll(async () => (await state()).phase).toBe('playing');
    expect((await state()).perClick).toBe(perClick);
    await game.keyboard.press('b');
    await expect.poll(async () => (await state()).total).toBe(20);
    await game.keyboard.press('b');
    await game.waitForTimeout(200);
    expect((await state()).total).toBe(20);
    await game.mouse.click(850, 538);
    await expect.poll(async () => (await state()).phase).toBe('paused');
    await game.waitForTimeout(3200);
    await game.keyboard.press('b');
    expect((await state()).total).toBe(20);
    await game.mouse.click(850, 538);
    await game.keyboard.press('b');
    await game.waitForTimeout(200);
    expect((await state()).total).toBe(20);
    await game.waitForTimeout(3100);
    await game.keyboard.press('b');
    await expect.poll(async () => (await state()).total).toBe(40);
    await game.mouse.click(500, 407);
    await expect.poll(async () => (await state()).total).toBe(40 + perClick);
    evidence[`${label}Gameplay`] = await state();
    await game.screenshot({ path: `${directory}/${label}-gameplay.png` });
    await game.close();
    await save();
  }
  await play(first.run.result_summary, 'development', 10);
  const sourceRoot = `unity/LocalProjects/${project.id}/Assets/Game/Scripts`;
  async function hashes() {
    const result: Record<string, string> = {};
    async function visit(path: string) {
      for (const entry of await readdir(join(sourceRoot, path), {
        withFileTypes: true,
      })) {
        const child = path ? `${path}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(child);
        else if (entry.name.endsWith('.cs'))
          result[child] = createHash('sha256')
            .update(await readFile(join(sourceRoot, child)))
            .digest('hex');
      }
    }
    await visit('');
    return result;
  }
  const before = await hashes();
  evidence.sourceBefore = before;
  await save();
  await discuss(
    '只把每次普通点击收益从10改为15。保留已经实现的奖励领取机制、B键、3秒冷却、暂停与重开规则，其余参数和名称完全不变，不增加新功能。整理修改后的制作说明。',
  );
  const second = await prepareConfirm('retained');
  await play(second.run.result_summary, 'retained', 15);
  const after = await hashes();
  evidence.sourceAfter = after;
  expect(after).toEqual(before);
  const manifest = JSON.parse(
    await readFile(
      `unity/LocalProjects/${project.id}/Assets/GamerHub/TemplateManifest.json`,
      'utf8',
    ),
  );
  evidence.manifest = manifest;
  evidence.status = 'passed';
  await save();
});
