import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('version restore recovers actual developed source and approved gameplay parameters', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires completed real mechanism-development evidence',
  );
  test.setTimeout(25 * 60 * 1000);
  const directory = 'artifacts/gameplay-extensibility';
  const resume = process.env.GAMERHUB_RESUME_SOURCE_RESTORE === '1';
  const developed = JSON.parse(
    await readFile(`${directory}/development-flow.json`, 'utf8'),
  );
  expect(developed.status).toBe('passed');
  const projectId = developed.projectId;
  // The browser state identifies the exact immutable source version.
  const versions = (
    await (await request.get(`/v1/projects/${projectId}/versions`)).json()
  ).items;
  const target = versions.find(
    (v: { id: string }) => v.id === developed.developmentGameplay.specVersionId,
  );
  if (!target) throw new Error('ORIGINAL_VERSION_REQUIRED');
  const codePath = `unity/LocalProjects/${projectId}/Assets/Game/Scripts/Generated/reward_burst.cs`;
  const before = await readFile(
    resume ? `${directory}/pre-restore-reward.cs.backup` : codePath,
  );
  const marker = '\n// UNPUBLISHED_SOURCE_RESTORE_PROBE\n';
  if (!resume) {
    await writeFile(`${directory}/pre-restore-reward.cs.backup`, before);
    await writeFile(codePath, Buffer.concat([before, Buffer.from(marker)]));
  }
  const evidence: Record<string, unknown> = resume
    ? JSON.parse(await readFile(`${directory}/source-restore.json`, 'utf8'))
    : {
        projectId,
        targetVersionId: target.id,
        beforeHash: createHash('sha256').update(before).digest('hex'),
        status: 'running',
      };
  const save = () =>
    writeFile(
      `${directory}/source-restore.json`,
      JSON.stringify(evidence, null, 2),
    );
  await save();
  expect(evidence.projectId).toBe(projectId);
  expect(evidence.targetVersionId).toBe(target.id);
  let runId = evidence.runId;
  if (!resume) {
    const accepted = await request.post(
      `/v1/projects/${projectId}/versions/${target.id}/restore`,
      { headers: { 'idempotency-key': `source-restore-${Date.now()}` } },
    );
    expect(accepted.status(), await accepted.text()).toBe(202);
    runId = (await accepted.json()).id;
  }
  expect(typeof runId).toBe('string');
  evidence.runId = runId;
  await save();
  let run: { status: string; result_summary: string };
  let previous = '';
  let pollingFailures = 0;
  for (;;) {
    const response = await request.get(
      `/v1/projects/${projectId}/runs/${runId}`,
    );
    if (!response.ok() && response.status() >= 500 && pollingFailures++ < 5) {
      console.log(
        `Restore polling temporarily unavailable: HTTP ${response.status()}`,
      );
      await page.waitForTimeout(5000);
      continue;
    }
    expect(response.ok(), await response.text()).toBe(true);
    pollingFailures = 0;
    run = await response.json();
    if (run.status !== previous) console.log(`RESTORE ${runId} ${run.status}`);
    previous = run.status;
    if (
      [
        'succeeded',
        'failed',
        'cancelled',
        'timed_out',
        'partially_succeeded',
        'rejected',
        'out_of_scope',
      ].includes(run.status)
    )
      break;
    await page.waitForTimeout(5000);
  }
  evidence.run = run;
  evidence.status = run.status === 'succeeded' ? 'checking_gameplay' : 'failed';
  await save();
  expect(run.status, JSON.stringify(run)).toBe('succeeded');
  const restored = await readFile(codePath);
  expect(restored.equals(before)).toBe(true);
  expect(restored.toString()).not.toContain('UNPUBLISHED_SOURCE_RESTORE_PROBE');
  evidence.restoredHash = createHash('sha256').update(restored).digest('hex');
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto(run.result_summary);
  const state = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __gamerhubGameState: {
              phase: string;
              perClick: number;
              total: number;
            };
          }
        ).__gamerhubGameState,
    );
  await expect
    .poll(async () => (await state())?.phase, { timeout: 150000 })
    .toBe('ready');
  await page.mouse.click(480, 483);
  await expect.poll(async () => (await state()).phase).toBe('playing');
  expect((await state()).perClick).toBe(10);
  await page.keyboard.press('b');
  await expect.poll(async () => (await state()).total).toBe(20);
  evidence.gameplay = await state();
  evidence.status = 'passed';
  await page.screenshot({ path: `${directory}/restored-gameplay.png` });
  await save();
});
