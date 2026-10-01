import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { snapshotSource } from '../../apps/local-dev/src/source-snapshot';

test('actual workbench shows recovered source and loads the preserved game', async ({
  page,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires completed actual recovery acceptance',
  );
  test.setTimeout(180000);
  const evidence = JSON.parse(
    await readFile('artifacts/agent-maturity/source-recovery.json', 'utf8'),
  );
  expect(evidence.status).toBe('passed');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/projects/${evidence.projectId}`);
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect(
    page.getByText('本次未完成的源码已归档，工程已恢复到制作前。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '本次未交付新版本' }),
  ).toBeVisible();
  await page.locator('iframe[title="游戏预览"]').scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () => {
        const game = page
          .frames()
          .find((frame) => frame.url().includes('/real-previews/'));
        return game?.evaluate(
          () =>
            (window as unknown as { __gamerhubGameState?: { phase: string } })
              .__gamerhubGameState?.phase,
        );
      },
      { timeout: 150000 },
    )
    .toBe('ready');
  await page.screenshot({
    path: 'artifacts/agent-maturity/recovered-workbench-final.png',
    fullPage: true,
  });
});

test('actual paused Unity failure restores source and preserves the last published game', async ({
  request,
  page,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires actual model, database, Unity and completed maturity lifecycle',
  );
  test.setTimeout(20 * 60 * 1000);
  const directory = 'artifacts/agent-maturity';
  const lifecycle = JSON.parse(
    await readFile(join(directory, 'mechanism-lifecycle.json'), 'utf8'),
  );
  expect(lifecycle.status).toBe('passed');
  const projectId = lifecycle.projectId;
  const api = `/v1/projects/${projectId}`;
  const root = join('unity/LocalProjects', projectId);
  const output = join(directory, 'source-recovery.json');
  const evidence: Record<string, unknown> = {
    projectId,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  const save = () => writeFile(output, JSON.stringify(evidence, null, 2));
  const current = await (await request.get(`${api}/design`)).json();
  const response = await request.post(`${api}/design/messages`, {
    data: {
      revision: current.revision,
      message:
        '只把游戏时长60秒改为65秒，其余完全保留，包括已退役的maturity_reward状态和验收，不改机制描述、验收、场景、素材和自定义代码。直接整理完整brief。',
    },
    timeout: 155000,
  });
  expect(response.ok(), await response.text()).toBe(true);
  let draft = await response.json();
  const prepared = await request.post(`${api}/design/prepare`, {
    data: { revision: draft.revision },
  });
  expect(prepared.ok(), await prepared.text()).toBe(true);
  draft = await prepared.json();
  const confirmed = await request.post(`${api}/design/confirm`, {
    data: { revision: draft.revision },
  });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  const runId = (await confirmed.json()).confirmedRunId;
  evidence.runId = runId;
  await save();
  const status = async () =>
    (await (await request.get(`${api}/runs/${runId}`)).json()).status;
  await expect
    .poll(
      async () => {
        const events = await (
          await request.get(`${api}/runs/${runId}/events`)
        ).text();
        return events
          .split('\n')
          .some(
            (line) =>
              line.includes('"type":"agent.act.started"') &&
              line.includes('"actionId":"unity-tests"'),
          );
      },
      { timeout: 300000, intervals: [1000, 2000] },
    )
    .toBe(true);
  const paused = await request.post(`${api}/runs/${runId}/pause`, {
    data: { reason: 'dedicated recovery acceptance' },
  });
  expect(paused.ok(), await paused.text()).toBe(true);
  await expect
    .poll(status, { timeout: 180000, intervals: [2000] })
    .toBe('paused');
  const journalPath = join(root, `.gamerhub/attempts/${runId}.json`);
  const baseline = JSON.parse(await readFile(journalPath, 'utf8'));
  expect(baseline.status).toBe('active');
  evidence.paused = { baseline, sourceRevision: await snapshotSource(root) };
  // Only this dedicated acceptance project is changed, after the worker releases Unity.
  const fault = join(root, 'Assets/Tests/PlayMode/Generated/RecoveryFault.cs');
  await writeFile(fault, '#error INTENTIONAL_MATURITY_RECOVERY_ACCEPTANCE\n');
  evidence.injectedAt = new Date().toISOString();
  await save();
  const resumed = await request.post(`${api}/runs/${runId}/resume`);
  expect(resumed.ok(), await resumed.text()).toBe(true);
  await expect
    .poll(status, { timeout: 600000, intervals: [3000] })
    .toBe('failed');
  const events = await (
    await request.get(`${api}/runs/${runId}/events`)
  ).text();
  await writeFile(join(directory, 'source-recovery-events.txt'), events);
  expect(events).toContain('run.source.recovered');
  expect(events).not.toContain('run.delivery.prepared');
  const recovered = JSON.parse(await readFile(journalPath, 'utf8'));
  expect(recovered.status).toBe('recovered');
  expect(recovered.archivedRevision).not.toBe(recovered.baselineRevision);
  expect(await snapshotSource(root)).toBe(baseline.baselineRevision);
  await expect(readFile(fault)).rejects.toMatchObject({ code: 'ENOENT' });
  await page.goto(lifecycle.retired.run.result_summary);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __gamerhubGameState: { phase: string } })
              .__gamerhubGameState?.phase,
        ),
      { timeout: 150000 },
    )
    .toBe('ready');
  await page.screenshot({
    path: join(directory, 'recovered-previous-preview.png'),
  });
  evidence.recovered = recovered;
  evidence.finalRevision = await snapshotSource(root);
  evidence.previousPreview = lifecycle.retired.run.result_summary;
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});
