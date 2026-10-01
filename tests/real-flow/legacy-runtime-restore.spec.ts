import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('old Runner version still builds after multi-genre use and returns to Survivor', async ({
  request,
  page,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires explicit real engine execution',
  );
  test.setTimeout(20 * 60 * 1000);
  const project = process.env.GAMERHUB_FLOW_PROJECT_ID;
  if (!project) throw new Error('Project required');
  const previous = JSON.parse(
    await readFile('artifacts/multigenre/cycle.json', 'utf8'),
  );
  expect(previous.status).toBe('passed');
  const survivorId = previous.gameplay.find(
    (item: { label: string }) => item.label === 'modified',
  ).before.specVersionId;
  const versions = (
    await (await request.get(`/v1/projects/${project}/versions`)).json()
  ).items;
  const oldRunner = versions.find(
    (item: { versionNumber: number }) => item.versionNumber === 2,
  );
  expect(oldRunner).toBeTruthy();
  const evidence: Record<string, unknown> = {
    project,
    oldRunnerVersion: oldRunner.id,
    survivorVersion: survivorId,
  };
  async function restore(version: string) {
    const response = await request.post(
      `/v1/projects/${project}/versions/${version}/restore`,
      { headers: { 'idempotency-key': `compat-${version}-${Date.now()}` } },
    );
    expect(response.status()).toBe(202);
    const id = (await response.json()).id;
    let last = '';
    for (;;) {
      const run = await (
        await request.get(`/v1/projects/${project}/runs/${id}`)
      ).json();
      if (run.status !== last) console.log(`COMPAT ${id} ${run.status}`);
      last = run.status;
      if (
        [
          'succeeded',
          'failed',
          'cancelled',
          'out_of_scope',
          'rejected',
          'timed_out',
          'partially_succeeded',
        ].includes(last)
      ) {
        expect(last, JSON.stringify(run)).toBe('succeeded');
        return run;
      }
      await page.waitForTimeout(5000);
    }
  }
  try {
    const runner = await restore(oldRunner.id);
    evidence.runner = runner;
    const config = JSON.parse(
      await readFile(
        `unity/LocalProjects/${project}/Assets/Resources/GamerHubGameConfig.json`,
        'utf8',
      ),
    );
    expect(config.runtime).toBe('runner-v1');
    expect(config.genre).toBe('runner');
    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto(runner.result_summary);
    await expect(page.locator('canvas')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120000,
    });
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: 'artifacts/multigenre/legacy-runner-ready.png',
    });
    await page.mouse.click(480, 386);
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'artifacts/multigenre/legacy-runner-playing.png',
    });
  } finally {
    const restored = await restore(survivorId);
    evidence.restored = restored;
    await page.goto(restored.result_summary);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __gamerhubGameState?: { runtime: string };
                }
              ).__gamerhubGameState?.runtime,
          ),
        { timeout: 120000 },
      )
      .toBe('arena-v1');
    await writeFile(
      'artifacts/multigenre/legacy-restore.json',
      JSON.stringify(evidence, null, 2),
    );
  }
  evidence.status = 'passed';
  await writeFile(
    'artifacts/multigenre/legacy-restore.json',
    JSON.stringify(evidence, null, 2),
  );
});
