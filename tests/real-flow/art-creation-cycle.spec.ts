import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PostgresDomainRepository } from '../../packages/domain/src/repositories/postgres';
import type {
  ArtCandidate,
  GameSpec,
} from '../../packages/game-spec/src/index';

test('FastAPI and automatic art: discuss, generate, select, build, change art and restore', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Real model and Unity explicitly enabled',
  );
  test.setTimeout(45 * 60 * 1000);
  const directory = 'artifacts/art-flow';
  await mkdir(directory, { recursive: true });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    runs: [],
  };
  const records: unknown[] = [];
  evidence.runs = records;
  const save = () =>
    writeFile(`${directory}/cycle.json`, JSON.stringify(evidence, null, 2));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect(
    await (await request.get('/api/gamerhub/health')).json(),
  ).toMatchObject({
    framework: 'fastapi',
    domainTransport: 'stdio',
    provenance: 'real-unity-local-dev',
  });
  let projectId = process.env.GAMERHUB_FLOW_PROJECT_ID;
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(projectId ? `/projects/${projectId}` : '/');
  async function discuss(text: string) {
    await page.getByLabel('和 AI 讨论你的游戏').fill(text);
    const waiting = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/messages'),
      { timeout: 155000 },
    );
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    const result = await waiting;
    expect(result.ok(), await result.text()).toBe(true);
    projectId = new URL(result.url()).pathname.split('/')[3];
    await expect(page.getByLabel('和 AI 讨论你的游戏')).toHaveValue('');
  }
  await discuss(
    '我想继续做适合小白的猫咪跑酷，请先和我确定玩法，再去素材工作室选画风。',
  );
  await discuss(
    '玩法用轻松模式，一局30秒，速度3，跳跃力度8，道具间隔4秒，每枚金币10分。我想比较月夜蓝色与粉紫暮色，之后在素材面板选择。',
  );
  evidence.projectId = projectId;
  await save();
  const path = `/v1/projects/${projectId}`;
  const runsBefore = (await (await request.get(`${path}/runs`)).json()).items
    .length;
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
  await page
    .getByLabel('希望游戏看起来是什么感觉？')
    .fill(
      '想比较月夜蓝色和粉紫暮色的森林。请自动配齐猫咪、背景、金币和木桩，木桩碰到就失败，不能当踏板。',
    );
  const generating = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/art/generate'),
  );
  await page
    .getByRole('button', { name: /自动准备两组素材|按新描述再准备两组/ })
    .click();
  expect((await generating).status()).toBe(202);
  await expect
    .poll(
      async () => (await (await request.get(`${path}/art`)).json()).status,
      { timeout: 240000, intervals: [2000] },
    )
    .not.toBe('generating');
  const plan = await (await request.get(`${path}/art`)).json();
  expect(plan.status, `Art preparation: ${plan.errorCode ?? plan.status}`).toBe(
    'ready',
  );
  const candidates = plan.candidates.slice(-2) as ArtCandidate[];
  expect(candidates).toHaveLength(2);
  expect(candidates.every((candidate) => candidate.assets.length === 4)).toBe(
    true,
  );
  evidence.candidates = candidates;
  for (const candidate of candidates) {
    const card = page.locator(`[data-candidate-id="${candidate.id}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    for (const asset of candidate.assets)
      await expect
        .poll(() =>
          card
            .getByRole('img', { name: asset.name, exact: true })
            .evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
  }
  await page.screenshot({
    path: `${directory}/candidates.png`,
    fullPage: true,
  });
  await save();

  async function selectAndConfirm(candidate: ArtCandidate, label: string) {
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    const selected = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/art/select'),
    );
    await page
      .locator(`[data-candidate-id="${candidate.id}"]`)
      .getByRole('button', { name: '选择这一组' })
      .click();
    expect((await selected).ok()).toBe(true);
    await page.getByRole('button', { name: '带着这组素材查看方案 →' }).click();
    const preparing = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/prepare'),
    );
    await page
      .getByRole('button', { name: '方案聊好了，生成制作说明 →', exact: true })
      .click();
    const prepared = await preparing;
    expect(prepared.ok(), await prepared.text()).toBe(true);
    const design = await prepared.json();
    expect(design.spec.extensions.gamerhub_art.id).toBe(candidate.id);
    expect(
      await page.getByRole('region', { name: '制作说明 Spec' }).textContent(),
    ).toContain(candidate.name);
    evidence[`${label}Spec`] = design.spec;
    const admitted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith('/design/confirm'),
    );
    await page
      .getByRole('button', { name: '确认说明，开始制作 →', exact: true })
      .click();
    const accepted = await admitted;
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const runId = (await accepted.json()).confirmedRunId;
    evidence[`${label}RunId`] = runId;
    await save();
    return { runId, spec: design.spec as GameSpec };
  }
  async function waitRun(runId: string, spec: GameSpec, label: string) {
    let status = '';
    let paused = false;
    for (;;) {
      const run = await (await request.get(`${path}/runs/${runId}`)).json();
      if (run.status !== status)
        console.log(`ART_RUN ${label} ${runId} ${run.status}`);
      status = run.status;
      if (
        label === 'first' &&
        !paused &&
        process.env.GAMERHUB_FLOW_PAUSE_ONCE === '1' &&
        status === 'executing'
      ) {
        const events = await (
          await request.get(`${path}/runs/${runId}/events`)
        ).text();
        if (
          events.includes('targeted-playtest') ||
          events.includes('playtest-run')
        ) {
          await page
            .getByRole('button', { name: '试玩游戏', exact: true })
            .click();
          await page
            .getByRole('button', { name: '暂停制作', exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await (await request.get(`${path}/runs/${runId}`)).json())
                  .status,
              { timeout: 600000, intervals: [2000] },
            )
            .toBe('paused');
          await expect(
            page.getByText('制作已暂停', { exact: true }),
          ).toBeVisible({ timeout: 15000 });
          await page.screenshot({
            path: `${directory}/agent-paused.png`,
            fullPage: true,
          });
          evidence.pauseResume = { runId, pausedAt: new Date().toISOString() };
          await save();
          await page
            .getByRole('button', { name: '继续制作', exact: true })
            .click();
          paused = true;
          console.log(`ART_RUN ${label} ${runId} paused-and-resumed`);
        }
      }
      if (
        [
          'succeeded',
          'failed',
          'cancelled',
          'timed_out',
          'partially_succeeded',
          'rejected',
          'out_of_scope',
        ].includes(status)
      ) {
        records.push(run);
        await save();
        expect(status, JSON.stringify(run)).toBe('succeeded');
        const eventText = await (
          await request.get(`${path}/runs/${runId}/events`)
        ).text();
        await writeFile(`${directory}/${label}-events.txt`, eventText);
        if (label === 'first' && process.env.GAMERHUB_FLOW_PAUSE_ONCE === '1') {
          expect(paused).toBe(true);
          const actions = eventText
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => JSON.parse(line.slice(5)))
            .filter(
              (event) =>
                event.type === 'agent.act.started' &&
                ['targeted-playtest', 'playtest-run'].includes(
                  event.payload?.actionId,
                ),
            );
          expect(actions).toHaveLength(1);
          evidence.playtestExecutedOnceAfterResume = true;
          await save();
        }
        const repository = PostgresDomainRepository.fromEnvironment();
        try {
          const rows = await repository.pool.query(
            'SELECT s.spec_json FROM projects p JOIN game_spec_versions s ON s.id=p.current_spec_version_id WHERE p.id=$1',
            [projectId],
          );
          expect(rows.rows[0].spec_json).toEqual(spec);
        } finally {
          await repository.close();
        }
        const manifest = JSON.parse(
          await readFile(
            `unity/LocalProjects/${projectId}/Assets/Resources/GamerHubArtBindings.json`,
            'utf8',
          ),
        );
        const art = spec.extensions?.gamerhub_art as ArtCandidate;
        expect(manifest.candidateId).toBe(art.id);
        for (const asset of art.assets) {
          const bytes = await readFile(
            `unity/LocalProjects/${projectId}/Assets/Resources/Art/${asset.role}.png`,
          );
          expect(
            `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
          ).toBe(asset.contentHash);
        }
        return run;
      }
      await page.waitForTimeout(5000);
    }
  }
  async function play(url: string, label: string, candidate: ArtCandidate) {
    await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
    await expect(page.locator('iframe[title="游戏预览"]')).toHaveAttribute(
      'src',
      url,
      { timeout: 30000 },
    );
    const game = await context.newPage();
    game.on('pageerror', (error) => errors.push(error.message));
    await game.setViewportSize({ width: 960, height: 600 });
    await game.goto(url);
    await expect(game.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120000,
    });
    await game.waitForTimeout(6000);
    await game.screenshot({ path: `${directory}/${label}-tutorial.png` });
    await game.locator('canvas').click({ position: { x: 480, y: 386 } });
    await game.waitForTimeout(1000);
    await game.keyboard.press('Space');
    await game.waitForTimeout(250);
    await game.screenshot({ path: `${directory}/${label}-playing.png` });
    await game.close();
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    await expect(
      page.locator(`[data-candidate-id="${candidate.id}"]`),
    ).toContainText('当前游戏正在使用', { timeout: 15000 });
  }
  expect((await (await request.get(`${path}/runs`)).json()).items.length).toBe(
    runsBefore,
  );
  const first = await selectAndConfirm(candidates[0] as ArtCandidate, 'first');
  const firstRun = await waitRun(first.runId, first.spec, 'first');
  await play(firstRun.result_summary, 'first', candidates[0] as ArtCandidate);
  const originalVersion = (
    await (await request.get(`${path}/versions`)).json()
  ).items.find((version: { status: string }) => version.status === 'active');
  const second = await selectAndConfirm(
    candidates[1] as ArtCandidate,
    'second',
  );
  const secondRun = await waitRun(second.runId, second.spec, 'second');
  await play(secondRun.result_summary, 'second', candidates[1] as ArtCandidate);
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await page
    .locator('.studio-history > summary')
    .filter({ hasText: '历史版本' })
    .click();
  const restored = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().endsWith(`/versions/${originalVersion.id}/restore`),
  );
  // Version summaries can repeat; use the matching row's stable version number ordering.
  const versions = (await (await request.get(`${path}/versions`)).json()).items
    .slice()
    .reverse();
  const index = versions.findIndex(
    (version: { id: string }) => version.id === originalVersion.id,
  );
  await page
    .locator('.studio-history')
    .filter({ has: page.locator('summary', { hasText: '历史版本' }) })
    .locator(':scope > div')
    .nth(index)
    .getByRole('button', { name: '恢复这一版' })
    .click();
  const restoreResponse = await restored;
  expect(restoreResponse.status()).toBe(202);
  const restoreRun = await waitRun(
    (await restoreResponse.json()).id,
    first.spec,
    'restored',
  );
  await page.reload();
  await play(
    restoreRun.result_summary,
    'restored',
    candidates[0] as ArtCandidate,
  );
  expect(errors).toEqual([]);
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  evidence.browserErrors = errors;
  await save();
});
