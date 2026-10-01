import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesignDocument } from '@gamerhub/game-spec';
import { expect, test } from '@playwright/test';
import { PostgresDomainRepository } from '../../packages/domain/src/repositories/postgres';

type GameState = {
  phase: string;
  genre: string;
  specVersionId: string;
  elapsed: number;
  x: number;
  y: number;
  total: number;
  perClick: number;
  wallet: number;
};
type Run = { id: string; status: string; result_summary: string };
interface Evidence {
  mode: string;
  status: string;
  startedAt: string;
  projectId?: string;
  runId?: string;
  run?: Run;
  design?: DesignDocument;
  messages: string[];
  gameplay?: GameState;
  finishedAt?: string;
}

for (const mode of ['quick', 'discuss'] as const) {
  test(`actual ${mode} entry completes the whole browser-to-game flow`, async ({
    page,
    request,
    context,
  }) => {
    test.skip(
      process.env.GAMERHUB_REAL_FLOW !== '1',
      'Requires actual model, PostgreSQL, Unity and production services',
    );
    test.setTimeout(30 * 60 * 1000);
    const directory = 'artifacts/creation-flows';
    await mkdir(directory, { recursive: true });
    const evidencePath = join(directory, `${mode}.json`);
    const evidence: Evidence =
      process.env.GAMERHUB_ENTRY_RESUME === '1'
        ? JSON.parse(await readFile(evidencePath, 'utf8'))
        : {
            mode,
            status: 'running',
            startedAt: new Date().toISOString(),
            messages: [],
          };
    const save = () =>
      writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(
      evidence.projectId ? `/projects/${evidence.projectId}` : '/',
    );
    async function message(content: string) {
      const input = page.getByLabel('和 AI 讨论你的游戏');
      await expect(input).toBeEnabled();
      await input.fill(content);
      const pending = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/design/messages'),
        { timeout: 155000 },
      );
      await page
        .getByRole('button', {
          name: mode === 'quick' ? '直接制作 →' : '发送 ↑',
          exact: true,
        })
        .click();
      const response = await pending;
      expect(response.ok(), await response.text()).toBe(true);
      evidence.projectId = new URL(response.url()).pathname.split('/')[3];
      evidence.messages.push(content);
      evidence.design = await response.json();
      await save();
      return evidence.design;
    }
    if (!evidence.runId) {
      await page
        .getByRole('button', {
          name: mode === 'quick' ? '一句话制作' : '详细讨论',
          exact: true,
        })
        .click();
      if (mode === 'quick') {
        await message('做一个轻松的猫咪跑酷游戏，名字叫“云朵散步”。');
        await expect
          .poll(
            async () => {
              const current = await (
                await request.get(`/v1/projects/${evidence.projectId}/design`)
              ).json();
              evidence.design = current;
              evidence.runId = current.confirmedRunId;
              return Boolean(evidence.runId);
            },
            { timeout: 30000 },
          )
          .toBe(true);
        expect(
          evidence.design?.messages.filter((item) => item.role === 'user'),
        ).toHaveLength(1);
        expect(evidence.design?.brief.genre).toBe('runner');
        expect(evidence.design?.brief.name).toBe('云朵散步');
      } else {
        await message(
          '我想做一个轻松的点击成长小游戏，主题是收集星光。先和我讨论玩法，暂时不要开始制作。',
        );
        expect(
          (
            await (
              await request.get(`/v1/projects/${evidence.projectId}/runs`)
            ).json()
          ).items,
        ).toHaveLength(0);
        await message(
          '第一版定为45秒达到200点资源，每次普通点击10，升级初价30，初始自动收益0，使用现有素材。暂时不要增加其他机制。',
        );
        await message(
          '名字叫“星光小铺”，把每次点击从10改为15，其余数值完全保留。现在范围确定，请整理方案供我确认。',
        );
        expect(evidence.design?.brief).toMatchObject({
          genre: 'clicker',
          name: '星光小铺',
          duration: 45,
          coinScore: 15,
          mechanics: { goal: 200, upgradeCost: 30, autoIncome: 0 },
        });
        expect(
          (
            await (
              await request.get(`/v1/projects/${evidence.projectId}/runs`)
            ).json()
          ).items,
        ).toHaveLength(0);
        await page.reload();
        await expect(
          page.getByText(evidence.messages[0] ?? '', { exact: true }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: '玩法与方案', exact: true })
          .click();
        const prepared = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/design/prepare'),
        );
        await page
          .getByRole('button', {
            name: '方案聊好了，生成制作说明 →',
            exact: true,
          })
          .click();
        const response = await prepared;
        expect(response.ok(), await response.text()).toBe(true);
        evidence.design = await response.json();
        await expect(
          page.getByRole('region', { name: '制作说明 Spec' }),
        ).toBeVisible();
        await page.screenshot({
          path: join(directory, 'discuss-reviewed-spec.png'),
          fullPage: true,
        });
        expect(
          (
            await (
              await request.get(`/v1/projects/${evidence.projectId}/runs`)
            ).json()
          ).items,
        ).toHaveLength(0);
        const confirmed = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/design/confirm'),
        );
        await page
          .getByRole('button', { name: '确认说明，开始制作 →', exact: true })
          .click();
        const accepted = await confirmed;
        expect(accepted.ok(), await accepted.text()).toBe(true);
        evidence.design = await accepted.json();
        evidence.runId = evidence.design?.confirmedRunId;
      }
      await save();
    }
    expect(evidence.runId).toBeTruthy();
    await page.reload();
    let previous = '';
    for (;;) {
      const response = await request.get(
        `/v1/projects/${evidence.projectId}/runs/${evidence.runId}`,
      );
      expect(response.ok(), await response.text()).toBe(true);
      evidence.run = await response.json();
      if (!evidence.run) throw new Error('RUN_REQUIRED');
      if (evidence.run.status !== previous)
        console.log(`${mode} ${evidence.runId} ${evidence.run.status}`);
      previous = evidence.run.status;
      if (
        [
          'succeeded',
          'failed',
          'cancelled',
          'timed_out',
          'partially_succeeded',
          'rejected',
          'out_of_scope',
        ].includes(previous)
      )
        break;
      await page.waitForTimeout(3000);
    }
    const events = await (
      await request.get(
        `/v1/projects/${evidence.projectId}/runs/${evidence.runId}/events`,
      )
    ).text();
    await writeFile(join(directory, `${mode}-events.txt`), events);
    await save();
    expect(evidence.run?.status, JSON.stringify(evidence.run)).toBe(
      'succeeded',
    );
    expect(events).toContain('run.delivery.prepared');
    const repository = PostgresDomainRepository.fromEnvironment();
    try {
      const result = await repository.pool.query(
        'SELECT s.spec_json FROM projects p JOIN game_spec_versions s ON s.id=p.current_spec_version_id WHERE p.id=$1',
        [evidence.projectId],
      );
      expect(result.rows[0].spec_json).toEqual(evidence.design?.spec);
    } finally {
      await repository.close();
    }
    await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '本次交付已通过验证' }),
    ).toBeVisible({ timeout: 15000 });
    const iframe = page.locator('iframe[title="游戏预览"]');
    await expect(iframe).toHaveAttribute(
      'src',
      evidence.run?.result_summary ?? '',
    );
    await iframe.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () =>
          page
            .frames()
            .find((frame) => frame.url().includes('/real-previews/'))
            ?.evaluate(
              () =>
                (window as unknown as { __gamerhubGameState?: GameState })
                  .__gamerhubGameState?.phase,
            ),
        { timeout: 150000 },
      )
      .toBe('ready');
    await page.screenshot({
      path: join(directory, `${mode}-workbench.png`),
      fullPage: true,
    });
    const game = await context.newPage();
    await game.setViewportSize({ width: 960, height: 600 });
    game.on('pageerror', (error) => errors.push(error.message));
    await game.goto(evidence.run?.result_summary ?? '');
    const state = () =>
      game.evaluate(
        () =>
          (window as unknown as { __gamerhubGameState: GameState })
            .__gamerhubGameState,
      );
    await expect
      .poll(async () => (await state())?.phase, { timeout: 150000 })
      .toBe('ready');
    const startY = mode === 'quick' ? 386 : 482;
    await game.mouse.click(480, startY);
    await expect.poll(async () => (await state()).phase).toBe('playing');
    const pause = async () =>
      mode === 'quick' ? game.keyboard.press('p') : game.mouse.click(850, 538);
    await pause();
    await expect.poll(async () => (await state()).phase).toBe('paused');
    const pausedAt = (await state()).elapsed;
    await game.waitForTimeout(500);
    expect((await state()).elapsed).toBe(pausedAt);
    await pause();
    await expect.poll(async () => (await state()).phase).toBe('playing');
    if (mode === 'quick') {
      const before = await state();
      await game.keyboard.down('d');
      await game.waitForTimeout(150);
      await game.keyboard.up('d');
      await expect
        .poll(async () => (await state()).x)
        .toBeGreaterThan(before.x);
      await game.keyboard.down('Space');
      await expect
        .poll(async () => (await state()).y)
        .toBeGreaterThan(before.y + 0.1);
      await game.keyboard.up('Space');
    } else {
      expect((await state()).perClick).toBe(15);
      await game.mouse.click(500, 407);
      await expect.poll(async () => (await state()).total).toBe(15);
    }
    evidence.gameplay = await state();
    await game.screenshot({ path: join(directory, `${mode}-playing.png`) });
    // Use actual completion or collision, then the visible restart control.
    if (mode === 'discuss') {
      for (let index = 0; index < 14; index++) await game.mouse.click(500, 407);
    }
    await expect
      .poll(async () => ['won', 'lost'].includes((await state()).phase), {
        timeout: 190000,
      })
      .toBe(true);
    await game.mouse.click(480, startY);
    await expect
      .poll(async () => (await state()).phase)
      .toBe(mode === 'quick' ? 'ready' : 'playing');
    expect((await state()).total).toBe(0);
    await game.close();
    expect(errors).toEqual([]);
    evidence.status = 'passed';
    evidence.finishedAt = new Date().toISOString();
    await save();
  });
}
