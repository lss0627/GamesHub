import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PostgresDomainRepository } from '../../packages/domain/src/repositories/postgres';

test('real browser proxy, discussion, Spec, assets, Unity, modification and restore', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Explicit real engine/model execution required',
  );
  test.setTimeout(45 * 60 * 1000);
  const directory = 'artifacts/browser-flow';
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const evidence: Record<string, unknown> & {
    replies: Array<{ durationMs: number; content: string; reply: string }>;
    runs: Array<Record<string, unknown>>;
  } = {
    startedAt: new Date().toISOString(),
    replies: [],
    runs: [],
  };
  const save = () =>
    writeFile(`${directory}/cycle.json`, JSON.stringify(evidence, null, 2));
  let projectId = process.env.GAMERHUB_FLOW_PROJECT_ID;
  const resumeCreation = process.env.GAMERHUB_FLOW_RESUME_CREATED === '1';
  if (resumeCreation) {
    const previous = JSON.parse(
      await readFile(`${directory}/cycle.json`, 'utf8'),
    );
    expect(projectId).toBe(previous.projectId);
    expect(
      previous.runs.some(
        (run: { id: string; status: string }) =>
          run.id === previous.creationRunId && run.status === 'succeeded',
      ),
    ).toBe(true);
    Object.assign(evidence, previous, { resumedAt: new Date().toISOString() });
  }
  const health = await request.get('/api/gamerhub/health');
  expect(await health.json()).toMatchObject({
    provenance: 'real-unity-local-dev',
    dataPlane: { mode: 'postgres-redis' },
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(projectId ? `/projects/${projectId}` : '/');

  async function message(content: string) {
    const input = page.getByLabel('和 AI 讨论你的游戏');
    await expect(input).toBeEnabled();
    await input.fill(content);
    const started = Date.now();
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/messages'),
      { timeout: 155_000 },
    );
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    const response = await pending;
    const body = await response.text();
    expect(response.ok(), body).toBe(true);
    const design = JSON.parse(body);
    projectId = new URL(response.url()).pathname.split('/')[3];
    evidence.projectId = projectId;
    evidence.replies.push({
      durationMs: Date.now() - started,
      content,
      reply: design.messages.at(-1).content,
    });
    console.log(`BROWSER_AI_REPLY ${projectId} ${Date.now() - started}ms`);
    await expect(input).toHaveValue('');
    await save();
    return design;
  }

  async function confirm(label: string) {
    await page.getByRole('button', { name: '玩法与方案', exact: true }).click();
    const preparedResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/prepare'),
    );
    await page
      .getByRole('button', { name: '方案聊好了，生成制作说明 →', exact: true })
      .click();
    const prepared = await preparedResponse;
    expect(prepared.ok()).toBe(true);
    const design = await prepared.json();
    await expect(
      page.getByRole('region', { name: '制作说明 Spec' }),
    ).toBeVisible();
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
    const response = await accepted;
    expect(response.ok()).toBe(true);
    const confirmed = await response.json();
    evidence[`${label}ReviewedSpec`] = design.spec;
    evidence[`${label}RunId`] = confirmed.confirmedRunId;
    await save();
    return confirmed.confirmedRunId as string;
  }

  async function waitRun(runId: string, label: string) {
    let previous = '';
    for (;;) {
      const response = await request.get(
        `/v1/projects/${projectId}/runs/${runId}`,
      );
      expect(response.ok()).toBe(true);
      const run = await response.json();
      if (previous !== run.status)
        console.log(`RUN ${label} ${runId} ${run.status}`);
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
      ) {
        evidence.runs.push(run);
        await save();
        expect(run.status, JSON.stringify(run)).toBe('succeeded');
        const repository = PostgresDomainRepository.fromEnvironment();
        try {
          const rows = await repository.pool.query(
            'SELECT s.spec_json FROM projects p JOIN game_spec_versions s ON s.id=p.current_spec_version_id WHERE p.id=$1',
            [projectId],
          );
          expect(rows.rows[0].spec_json).toEqual(
            evidence[`${label}ReviewedSpec`],
          );
        } finally {
          await repository.close();
        }
        return run;
      }
      await page.waitForTimeout(5000);
    }
  }

  async function preview(url: string, label: string) {
    await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
    const iframe = page.locator('iframe[title="游戏预览"]');
    await expect(iframe).toHaveAttribute('src', url, { timeout: 30_000 });
    await iframe.scrollIntoViewIfNeeded();
    const frame = page.frameLocator('iframe[title="游戏预览"]');
    await expect(frame.locator('canvas')).toBeVisible({ timeout: 120_000 });
    await expect(frame.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    const response = await request.get(url);
    expect(response.headers()['x-gamerhub-provenance']).toBe(
      'real-unity-webgl',
    );
    const game = await context.newPage();
    game.on('pageerror', (error) => errors.push(error.message));
    await game.setViewportSize({ width: 960, height: 600 });
    await game.goto(url);
    await expect(game.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    await game.waitForTimeout(6000);
    await game.screenshot({ path: `${directory}/${label}-tutorial.png` });
    await game.locator('canvas').click({ position: { x: 480, y: 386 } });
    await game.waitForTimeout(1000);
    await game.keyboard.press('Space');
    await game.waitForTimeout(200);
    await game.screenshot({ path: `${directory}/${label}-playing.png` });
    await game.waitForTimeout(5000);
    await game.screenshot({ path: `${directory}/${label}-result.png` });
    await game.close();
    console.log(`WEBGL_READY ${label}`);
  }

  if (!resumeCreation) {
    await message(
      '我是小白，想做一个轻松的猫咪森林跑酷。先教我怎么玩，再一起敲定方案。',
    );
    const initial = await message(
      '用轻松模式，一局30秒，速度3，跳跃力度8，木桩间隔4秒，每枚金币10分。请保留这几个数值，并告诉我怎样通关。',
    );
    expect(initial.brief).toMatchObject({
      duration: 30,
      speed: 3,
      jump: 8,
      interval: 4,
      coinScore: 10,
    });
    await page.reload();
    await expect(
      page.getByText(
        '我是小白，想做一个轻松的猫咪森林跑酷。先教我怎么玩，再一起敲定方案。',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    for (const name of ['围巾橘猫', '晨光森林', '星星金币', '森林木桩']) {
      await expect
        .poll(() =>
          page
            .getByRole('img', { name, exact: true })
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    await page.locator('.studio-uploads > summary').click();
    await page.getByLabel('我拥有上传图片的使用权').check();
    const uploaded = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/assets'),
    );
    await page
      .getByLabel('上传素材图片')
      .setInputFiles('apps/studio-web/public/runner-art/cat.png');
    expect((await uploaded).ok()).toBe(true);
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'cat.png', exact: true })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: `${directory}/materials.png`,
      fullPage: true,
    });
    const created = await waitRun(await confirm('creation'), 'creation');
    await preview(created.result_summary, 'creation');
  } else {
    const created = await waitRun(String(evidence.creationRunId), 'creation');
    await preview(created.result_summary, 'creation-resumed');
  }
  const versions = (
    await (await request.get(`/v1/projects/${projectId}/versions`)).json()
  ).items;
  const original = versions.find(
    (v: { status: string }) => v.status === 'active',
  );
  evidence.originalSpecId = original.id;
  const changed = await message(
    '试玩之后，我想每枚金币改成20分，其余玩法、难度、时长、速度和跳跃都保持不变。',
  );
  expect(changed.brief).toMatchObject({
    duration: 30,
    speed: 3,
    jump: 8,
    interval: 4,
    coinScore: 20,
  });
  const modified = await waitRun(await confirm('modification'), 'modification');
  expect(evidence.modificationReviewedSpec).not.toEqual(
    evidence.creationReviewedSpec,
  );
  await preview(modified.result_summary, 'modification');
  await page
    .locator('.studio-history > summary')
    .filter({ hasText: '历史版本' })
    .click();
  const restoredResponse = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().endsWith(`/versions/${original.id}/restore`),
  );
  await page
    .locator('.studio-history > div')
    .filter({
      has: page.getByRole('button', { name: '恢复这一版', disabled: false }),
    })
    .getByRole('button', { name: '恢复这一版' })
    .click();
  const restored = await restoredResponse;
  expect(restored.status()).toBe(202);
  evidence.restoreReviewedSpec = evidence.creationReviewedSpec;
  const restoredRun = await waitRun((await restored.json()).id, 'restore');
  await preview(restoredRun.result_summary, 'restored');
  await page.reload();
  await preview(restoredRun.result_summary, 'reloaded');
  expect(errors).toEqual([]);
  evidence.browserErrors = errors;
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});
