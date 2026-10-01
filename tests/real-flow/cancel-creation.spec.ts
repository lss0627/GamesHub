import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('creator can stop a real active run while preserving the last playable version', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1' ||
      !process.env.GAMERHUB_FLOW_PROJECT_ID,
    'Explicit existing real project required',
  );
  test.setTimeout(10 * 60 * 1000);
  const projectId = process.env.GAMERHUB_FLOW_PROJECT_ID;
  const path = `/v1/projects/${projectId}`;
  const versions = await (await request.get(`${path}/versions`)).json();
  const active = versions.items.find(
    (version: { status: string }) => version.status === 'active',
  );
  expect(active).toBeTruthy();
  const beforeRuns = await (await request.get(`${path}/runs`)).json();
  const beforePreview = [...beforeRuns.items]
    .reverse()
    .find(
      (run: { status: string; result_summary?: string }) =>
        run.status === 'succeeded' && run.result_summary?.startsWith('http'),
    )?.result_summary;
  expect(beforePreview).toBeTruthy();
  const accepted = await request.post(`${path}/runs`, {
    headers: { 'idempotency-key': `cancel-flow-${Date.now()}` },
    data: {
      request_type: 'modify',
      prompt: '请把每次收集的分数改成15分，其他玩法和素材保持不变。',
    },
  });
  expect(accepted.status()).toBe(202);
  const runId = (await accepted.json()).id;
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${path}/runs/${runId}`)).json()).status,
      { timeout: 180000, intervals: [1000] },
    )
    .toBe('executing');
  await page.getByRole('button', { name: '暂停制作', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${path}/runs/${runId}`)).json()).status,
      { timeout: 300000, intervals: [1500] },
    )
    .toBe('paused');
  await page.getByRole('button', { name: '继续制作', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${path}/runs/${runId}`)).json()).status,
      { timeout: 180000, intervals: [1000] },
    )
    .toBe('executing');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${path}/runs/${runId}`)).json()).status,
      { timeout: 300000, intervals: [1500] },
    )
    .toBe('cancelled');
  await expect(
    page.getByRole('region', { name: 'Agent 制作步骤' }),
  ).toContainText('本次制作已停止', { timeout: 15000 });
  const afterVersions = await (await request.get(`${path}/versions`)).json();
  expect(
    afterVersions.items.find(
      (version: { status: string }) => version.status === 'active',
    ).id,
  ).toBe(active.id);
  await expect(page.locator('iframe[title="游戏预览"]')).toHaveAttribute(
    'src',
    beforePreview,
  );
  const events = await (
    await request.get(`${path}/runs/${runId}/events`)
  ).text();
  expect(events).not.toContain('event: run.succeeded');
  expect(events).toContain('event: run.paused');
  await mkdir('artifacts/cancel-flow', { recursive: true });
  await page.screenshot({
    path: 'artifacts/cancel-flow/cancelled.png',
    fullPage: true,
  });
  await writeFile(
    'artifacts/cancel-flow/result.json',
    JSON.stringify(
      {
        projectId,
        runId,
        status: 'passed',
        pauseResumeVerified: true,
        activeVersionBefore: active.id,
        activeVersionAfter: active.id,
        previewPreserved: beforePreview,
      },
      null,
      2,
    ),
  );
  await writeFile('artifacts/cancel-flow/events.txt', events);
});
