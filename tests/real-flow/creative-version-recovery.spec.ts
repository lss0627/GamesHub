import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreativeDocument } from '@gamerhub/game-spec';
import { expect, test } from '@playwright/test';

type Recovery = {
  status: string;
  projectId: string;
  baselineVersion?: string;
  modifyRun?: string;
  restoreRun?: string;
  baseline: CreativeDocument;
  modified?: CreativeDocument;
  scriptHash?: string;
  preview?: string;
  finishedAt?: string;
};
test('creative versions preserve custom gameplay source and restore the prior published composition', async ({
  request,
  page,
}) => {
  test.skip(
    process.env.GAMERHUB_CREATIVE_RECOVERY !== '1',
    'Requires completed actual authoring acceptance',
  );
  test.setTimeout(40 * 60 * 1000);
  const directory = 'artifacts/creative-authoring';
  const original = JSON.parse(
    await readFile(join(directory, 'real-flow.json'), 'utf8'),
  );
  expect(original.status).toBe('passed');
  const evidencePath = join(directory, 'recovery.json');
  const evidence: Recovery =
    process.env.GAMERHUB_RECOVERY_RESUME === '1'
      ? JSON.parse(await readFile(evidencePath, 'utf8'))
      : {
          status: 'running',
          projectId: original.projectId,
          baseline: original.document,
        };
  const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  const base = `/v1/projects/${evidence.projectId}`;
  const source = join(
    'unity/LocalProjects',
    evidence.projectId,
    'Assets/Game/Scripts/ClickerSimulation.cs',
  );
  const sourceHash = async () =>
    createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
  const waitRun = async (id: string) => {
    let preview = '';
    await expect
      .poll(
        async () => {
          const response = await request
            .get(`${base}/runs/${id}`)
            .catch(() => undefined);
          if (
            !response?.ok() ||
            !response.headers()['content-type']?.includes('application/json')
          )
            return 'reconnecting';
          const run = await response.json();
          if (
            [
              'failed',
              'cancelled',
              'timed_out',
              'partially_succeeded',
            ].includes(run.status)
          )
            throw new Error(
              `ACTUAL_RECOVERY_${run.status}:${run.result_summary}`,
            );
          if (run.status === 'succeeded') preview = run.result_summary;
          return run.status;
        },
        { timeout: 18 * 60 * 1000, intervals: [5000] },
      )
      .toBe('succeeded');
    return preview;
  };
  if (!evidence.modifyRun) {
    const versions = (await (await request.get(`${base}/versions`)).json())
      .items as Array<{ id: string; status: string }>;
    evidence.baselineVersion = versions.find((v) => v.status === 'active')?.id;
    expect(evidence.baselineVersion).toBeTruthy();
    evidence.scriptHash = await sourceHash();
    const current = await (await request.get(`${base}/creative`)).json();
    expect(current.applied).toEqual(evidence.baseline);
    const modified = structuredClone(evidence.baseline);
    modified.masterVolume = 0.2;
    const text = modified.nodes.find((n) => n.kind === 'text');
    if (!text) throw new Error('TEXT_REQUIRED');
    text.text = '星光工坊 · 第二版';
    text.x = 730;
    const saved = await request.post(`${base}/creative`, {
      data: { revision: current.revision, document: modified },
    });
    expect(saved.ok()).toBeTruthy();
    const admitted = await request.post(`${base}/creative/apply`, {
      data: { revision: (await saved.json()).revision },
    });
    expect(admitted.status()).toBe(202);
    evidence.modifyRun = (await admitted.json()).confirmedRunId;
    evidence.modified = modified;
    await save();
  }
  if (!evidence.modifyRun) throw new Error('MODIFY_RUN_REQUIRED');
  if (!evidence.restoreRun) {
    await waitRun(evidence.modifyRun);
    expect(await sourceHash()).toBe(evidence.scriptHash);
    expect(
      (await (await request.get(`${base}/creative`)).json()).applied,
    ).toEqual(evidence.modified);
    const response = await request.post(
      `${base}/versions/${evidence.baselineVersion}/restore`,
      {
        headers: {
          'idempotency-key': `creative-recovery-${evidence.baselineVersion}`,
        },
      },
    );
    expect(response.status()).toBe(202);
    evidence.restoreRun = (await response.json()).id;
    await save();
  }
  if (!evidence.restoreRun) throw new Error('RESTORE_RUN_REQUIRED');
  evidence.preview = await waitRun(evidence.restoreRun);
  const final = await (await request.get(`${base}/creative`)).json();
  expect(final.applied).toEqual(evidence.baseline);
  expect(final.document).toEqual(evidence.modified);
  expect(await sourceHash()).toBe(evidence.scriptHash);
  expect(
    JSON.parse(
      await readFile(
        join(
          'unity/LocalProjects',
          evidence.projectId,
          'Assets/Resources/GamerHubCreative.json',
        ),
        'utf8',
      ),
    ),
  ).toEqual(evidence.baseline);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto(evidence.preview);
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __gamerhubCreativeState?: unknown })
          .__gamerhubCreativeState,
      ),
    undefined,
    { timeout: 180000 },
  );
  const actual = await page.evaluate(
    () =>
      (
        window as unknown as {
          __gamerhubCreativeState: { nodes: number; contentHash: string };
        }
      ).__gamerhubCreativeState,
  );
  expect(actual.nodes).toBe(evidence.baseline.nodes.length);
  const bytes = await readFile(
    join(
      'unity/LocalProjects',
      evidence.projectId,
      'Assets/Resources/GamerHubCreative.json',
    ),
  );
  expect(actual.contentHash).toBe(
    `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
  );
  await page.screenshot({ path: join(directory, 'restored.png') });
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});
