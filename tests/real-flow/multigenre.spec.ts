import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

type RunView = { id: string; status: string; result_summary: string };
type RuntimeState = {
  runtime: string;
  phase: string;
  specVersionId: string;
  x: number;
  y: number;
  xpX: number;
  xpY: number;
  kills: number;
  pickups: number;
  damage: number;
  level: number;
  wallet: number;
  perClick: number;
  autoIncome: number;
};

test('real model, multi-genre Spec, Unity gameplay, parameter revision and restore', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Explicit real engine/model execution required',
  );
  test.setTimeout(45 * 60 * 1000);
  const projectId = process.env.GAMERHUB_FLOW_PROJECT_ID;
  if (!projectId)
    throw new Error(
      'GAMERHUB_FLOW_PROJECT_ID required for a reviewed existing project',
    );
  const directory = 'artifacts/multigenre';
  await mkdir(directory, { recursive: true });
  const evidence: Record<string, unknown> & {
    replies: unknown[];
    runs: unknown[];
    gameplay: unknown[];
  } = {
    projectId,
    startedAt: new Date().toISOString(),
    replies: [],
    runs: [],
    gameplay: [],
  };
  const save = () =>
    writeFile(`${directory}/cycle.json`, JSON.stringify(evidence, null, 2));
  const resume = process.env.GAMERHUB_FLOW_RESUME_MODIFIED === '1';
  if (resume) {
    const previous = JSON.parse(
      await readFile(`${directory}/cycle.json`, 'utf8'),
    );
    expect(previous.projectId).toBe(projectId);
    expect(
      previous.gameplay.some(
        (item: { label: string }) => item.label === 'modified',
      ),
    ).toBe(true);
    Object.assign(evidence, previous, { resumedAt: new Date().toISOString() });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`/projects/${projectId}`);
  const catalog = await request.get('/v1/game-capabilities');
  expect(catalog.ok()).toBe(true);
  expect(
    (await catalog.json()).capabilities.some(
      (c: { genre: string; runtime?: string }) =>
        c.genre === 'survivor' && c.runtime === 'arena-v1',
    ),
  ).toBe(true);
  async function message(content: string) {
    const input = page.getByLabel('和 AI 讨论你的游戏');
    await expect(input).toBeEnabled({ timeout: 30000 });
    await input.fill(content);
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/messages'),
      { timeout: 155000 },
    );
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const design = await response.json();
    evidence.replies.push({
      content,
      brief: design.brief,
      reply: design.messages.at(-1).content,
    });
    await save();
    console.log(
      `AI ${design.brief.genre}: ${design.messages.at(-1).content.slice(0, 100)}`,
    );
    return design;
  }
  async function confirm(label: string, genre: string) {
    await page.getByRole('button', { name: '玩法与方案', exact: true }).click();
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/prepare'),
    );
    await page
      .getByRole('button', { name: '方案聊好了，生成制作说明 →', exact: true })
      .click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const design = await response.json();
    expect(design.spec.game.genre).toBe(genre);
    evidence[`${label}Spec`] = design.spec;
    await page.screenshot({
      path: `${directory}/${label}-spec.png`,
      fullPage: true,
    });
    const accepted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/confirm'),
    );
    await page
      .getByRole('button', { name: '确认说明，开始制作 →', exact: true })
      .click();
    const result = await accepted;
    expect(result.ok(), await result.text()).toBe(true);
    const id = (await result.json()).confirmedRunId;
    evidence[`${label}RunId`] = id;
    await save();
    return waitRun(id);
  }
  async function waitRun(id: string) {
    let status = '';
    for (;;) {
      const response = await request.get(
        `/v1/projects/${projectId}/runs/${id}`,
      );
      expect(response.ok()).toBe(true);
      const run = await response.json();
      if (status !== run.status) console.log(`RUN ${id} ${run.status}`);
      status = run.status;
      if (
        [
          'succeeded',
          'failed',
          'timed_out',
          'cancelled',
          'partially_succeeded',
          'rejected',
          'out_of_scope',
        ].includes(status)
      ) {
        evidence.runs.push(run);
        await save();
        expect(status, JSON.stringify(run)).toBe('succeeded');
        return run;
      }
      await page.waitForTimeout(5000);
    }
  }
  async function state(game: Page) {
    return game.evaluate(
      () =>
        (window as unknown as { __gamerhubGameState: RuntimeState })
          .__gamerhubGameState,
    );
  }
  async function openGame(run: RunView, runtime: string) {
    const game = await context.newPage();
    await game.setViewportSize({ width: 960, height: 600 });
    await game.goto(run.result_summary);
    await expect
      .poll(async () => (await state(game))?.runtime, { timeout: 150000 })
      .toBe(runtime);
    expect((await state(game)).phase).toBe('ready');
    const config = JSON.parse(
      await readFile(
        `unity/LocalProjects/${projectId}/Assets/Resources/GamerHubGameConfig.json`,
        'utf8',
      ),
    );
    expect((await state(game)).specVersionId).toBe(config.specVersionId);
    return game;
  }
  async function playArena(
    run: RunView,
    expectedDamage: number,
    label: string,
  ) {
    const game = await openGame(run, 'arena-v1');
    await game.mouse.click(480, 393);
    await expect.poll(async () => (await state(game)).phase).toBe('playing');
    expect((await state(game)).damage).toBe(expectedDamage);
    await game.keyboard.down('d');
    await game.waitForTimeout(400);
    await game.keyboard.up('d');
    expect((await state(game)).x).toBeGreaterThan(0.5);
    await expect
      .poll(async () => (await state(game)).kills, { timeout: 30000 })
      .toBeGreaterThan(0);
    for (let i = 0; i < 250; i++) {
      const s = await state(game);
      if (s.phase === 'upgrade') break;
      expect(s.phase).toBe('playing');
      if (s.pickups > 0) {
        const horizontal = s.xpX - s.x;
        const vertical = s.xpY - s.y;
        const key =
          Math.abs(horizontal) > Math.abs(vertical)
            ? horizontal > 0
              ? 'd'
              : 'a'
            : vertical > 0
              ? 'w'
              : 's';
        await game.keyboard.down(key);
        await game.waitForTimeout(90);
        await game.keyboard.up(key);
      } else await game.waitForTimeout(100);
    }
    const before = await state(game);
    expect(before.phase).toBe('upgrade');
    await game.screenshot({ path: `${directory}/${label}-upgrade.png` });
    await game.mouse.click(290, 329);
    await expect
      .poll(async () => (await state(game)).damage)
      .toBe(expectedDamage + 1);
    const after = await state(game);
    expect(after.level).toBe(2);
    evidence.gameplay.push({ label, before, after });
    await save();
    await game.screenshot({ path: `${directory}/${label}-playing.png` });
    await game.close();
  }
  if (!resume) {
    const draft = await message(
      '请把这个项目改成俯视角幸存者：WASD自由移动，敌人追踪，自动攻击，击杀掉经验，升级时选伤害、攻速或回血。先做这个核心循环，不需要大世界、多武器进化、联机或新美术。名字叫星灯幸存者。',
    );
    expect(draft.brief.genre).toBe('survivor');
    const detail = await message(
      '首版就按这个范围。请设一局60秒，玩家速度5、生命10、攻击伤害2、间隔0.5秒、范围5，敌人生命2、速度1，每2秒出一个，每1点经验升级。先用内置原型素材。其他保持默认，明确告诉我怎么玩。',
    );
    expect(detail.brief.mechanics).toMatchObject({ damage: 2, xpPerLevel: 1 });
    const survivor = await confirm('survivor', 'survivor');
    await playArena(survivor, 2, 'survivor');
    await message('其他全部不变，只把初始攻击伤害从2提高到3。');
    const modified = await confirm('modified', 'survivor');
    await playArena(modified, 3, 'modified');
  }
  const versions = (
    await (await request.get(`/v1/projects/${projectId}/versions`)).json()
  ).items;
  const survivorVersion = versions.find(
    (v: { id: string }) =>
      v.id ===
      (
        evidence.gameplay.find(
          (item) => (item as { label: string }).label === 'modified',
        ) as { before: { specVersionId: string } }
      ).before.specVersionId,
  );
  expect(survivorVersion).toBeTruthy();
  await message(
    '再验证另一个完全不同的类型：把下一版设计为点击成长游戏，点击收集资源，购买升级增加点击和自动收益，70秒内达到300资源胜利。每次10，升级初始价格30，初始自动收益0，用内置素材。无需移动或战斗。',
  );
  const clickerRun = await confirm('clicker', 'clicker');
  const clicker = await openGame(clickerRun, 'clicker-v1');
  await clicker.mouse.click(480, 483);
  await expect.poll(async () => (await state(clicker)).phase).toBe('playing');
  for (let i = 0; i < 3; i++) {
    await clicker.mouse.click(510, 411, { delay: 50 });
    await clicker.waitForTimeout(100);
  }
  await expect
    .poll(async () => (await state(clicker)).wallet)
    .toBeGreaterThanOrEqual(30);
  await clicker.mouse.click(775, 411);
  await expect.poll(async () => (await state(clicker)).perClick).toBe(20);
  const upgraded = await state(clicker);
  expect(upgraded.autoIncome).toBe(2);
  for (let i = 0; i < 20 && (await state(clicker)).phase === 'playing'; i++) {
    await clicker.mouse.click(510, 411, { delay: 50 });
    await clicker.waitForTimeout(100);
  }
  await expect.poll(async () => (await state(clicker)).phase).toBe('won');
  await clicker.mouse.click(510, 411, { clickCount: 2 });
  await clicker.waitForTimeout(250);
  expect((await state(clicker)).phase).toBe('won');
  evidence.gameplay.push({
    label: 'clicker',
    upgraded,
    won: await state(clicker),
  });
  await save();
  await clicker.screenshot({ path: `${directory}/clicker-won.png` });
  await clicker.close();
  const restored = await request.post(
    `/v1/projects/${projectId}/versions/${survivorVersion.id}/restore`,
    { headers: { 'idempotency-key': `multigenre-restore-${Date.now()}` } },
  );
  expect(restored.status()).toBe(202);
  const restoredRun = await waitRun((await restored.json()).id);
  await playArena(restoredRun, 3, 'restored');
  const finalDraft = await message(
    '现在继续完善刚刚恢复的幸存者版本，不再做点击游戏。请让草案与当前已发布的幸存者一致：60秒、速度5、生命10、伤害3、攻击间隔0.5、范围5、敌人生命2速度1、每2秒生成、每1经验升级。不要制作，也不要再改参数，只告诉我怎么玩。',
  );
  expect(finalDraft.brief.genre).toBe('survivor');
  expect(finalDraft.brief.mechanics).toMatchObject({
    damage: 3,
    maxHp: 10,
    xpPerLevel: 1,
  });
  evidence.finalDraft = finalDraft.brief;
  await page.reload();
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect(page.locator('iframe[title="游戏预览"]')).toHaveAttribute(
    'src',
    restoredRun.result_summary,
    { timeout: 30000 },
  );
  await page.screenshot({
    path: `${directory}/studio-final.png`,
    fullPage: true,
  });
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});
