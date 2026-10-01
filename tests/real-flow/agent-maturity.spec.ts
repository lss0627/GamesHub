import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

interface PhaseEvidence {
  status?: string;
  runId?: string;
  run?: { status: string; result_summary: string };
  brief?: unknown;
  spec?: unknown;
  journal?: unknown;
  gameplay?: unknown;
  sceneHash?: string;
}
interface LifecycleEvidence {
  startedAt: string;
  status: string;
  projectId?: string;
  sentinelHash?: string;
  finishedAt?: string;
  created?: PhaseEvidence;
  updated?: PhaseEvidence;
  retired?: PhaseEvidence;
}

test('actual agent develops, revises and retires a mechanism with current acceptance and preserved scene', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires actual model, PostgreSQL, Unity and browser',
  );
  test.setTimeout(70 * 60 * 1000);
  const directory = 'artifacts/agent-maturity';
  await mkdir(directory, { recursive: true });
  const evidencePath = join(directory, 'mechanism-lifecycle.json');
  const evidence: LifecycleEvidence =
    process.env.GAMERHUB_MATURITY_RESUME === '1'
      ? JSON.parse(await readFile(evidencePath, 'utf8'))
      : { startedAt: new Date().toISOString(), status: 'running' };
  const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  if (!evidence.projectId) {
    const created = await request.post('/v1/projects', {
      data: { name: 'Agent成熟度独立验收' },
    });
    expect(created.ok(), await created.text()).toBe(true);
    evidence.projectId = (await created.json()).id;
    await save();
  }
  if (!evidence.projectId) throw new Error('PROJECT_REQUIRED');
  const projectId = evidence.projectId;
  const api = `/v1/projects/${projectId}`;
  const sourceRoot = `unity/LocalProjects/${projectId}`;
  const phases = [
    {
      label: 'created',
      reward: 20,
      prompt:
        '制作点击成长游戏，名称“星灯机制验收”，60秒目标300，每次普通点击10，升级初价30，自动收益0，使用现有素材。明确增加正式development机制，id必须为maturity_reward：游戏进行时按B或点击新增“领取奖励 +20”按钮，总资源与钱包同时增加20；3秒有效游戏时间内不能重复，暂停不领取且冻结冷却，开始前和结束后不领取，重开重置冷却。验收2条：1实际按B或按钮仅加20且3秒内不能重复；2暂停/未开始/结束不能领取且普通点击和升级正常。其余不变，范围已确定，请直接整理完整brief，不增加其他玩法。',
    },
    {
      label: 'updated',
      reward: 30,
      prompt:
        '只修改maturity_reward：单次奖励由20改为30，按钮也改为“领取奖励 +30”。保留id，operation为implement，更新description和acceptance明确实际按B或按钮只增加30，3秒内不能重复；暂停/开始前/结束后不领取，暂停冻结冷却，重开重置，普通点击10和购买升级继续正常。其他机制、参数、场景、素材和已有自定义文件不变。直接整理完整brief。',
    },
    {
      label: 'retired',
      reward: 0,
      prompt:
        '明确移除maturity_reward奖励机制：保留development里的id=maturity_reward，operation设为retire。移除按钮、B键入口与奖励效果。负向验收2条：1运行中按原B键不再增加任何资源且旧奖励按钮不存在；2原有普通点击仍每次10、升级购买正常，暂停和重新开始正常。保留所有其他参数、场景、自定义文件和素材。直接整理完整brief，不能直接删掉development数组里的id。',
    },
  ] as const;
  for (const phase of phases) {
    evidence[phase.label] ??= {};
    const step = evidence[phase.label];
    if (step.status === 'passed') continue;
    if (!step.runId) {
      const current = await (await request.get(`${api}/design`)).json();
      const response = await request.post(`${api}/design/messages`, {
        data: { revision: current.revision, message: phase.prompt },
        timeout: 155000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      let draft = await response.json();
      if (
        draft.messages.filter(
          (message: { role: string }) => message.role === 'user',
        ).length < 2
      ) {
        const confirmedScope = await request.post(`${api}/design/messages`, {
          data: {
            revision: draft.revision,
            message:
              '确认以上范围和参数。保留maturity_reward的全部行为、冷却和暂停规则、现有普通点击与升级；不增加其他内容，请整理制作说明。',
          },
          timeout: 155000,
        });
        expect(confirmedScope.ok(), await confirmedScope.text()).toBe(true);
        draft = await confirmedScope.json();
      }
      expect(draft.brief.genre).toBe('clicker');
      expect(draft.brief.development).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'maturity_reward',
            ...(phase.reward === 0 ? { operation: 'retire' } : {}),
          }),
        ]),
      );
      step.brief = draft.brief;
      await save();
      const prepared = await request.post(`${api}/design/prepare`, {
        data: { revision: draft.revision },
      });
      expect(prepared.ok(), await prepared.text()).toBe(true);
      draft = await prepared.json();
      step.spec = draft.spec;
      const confirmed = await request.post(`${api}/design/confirm`, {
        data: { revision: draft.revision },
      });
      expect(confirmed.ok(), await confirmed.text()).toBe(true);
      step.runId = (await confirmed.json()).confirmedRunId;
      await save();
    }
    let failures = 0;
    let previous = '';
    for (;;) {
      const response = await request.get(`${api}/runs/${step.runId}`);
      if (response.status() >= 500 && failures++ < 6) {
        await page.waitForTimeout(5000);
        continue;
      }
      expect(response.ok(), await response.text()).toBe(true);
      failures = 0;
      step.run = await response.json();
      if (!step.run) throw new Error('RUN_REQUIRED');
      if (step.run.status !== previous)
        console.log(`${phase.label} ${step.runId} ${step.run.status}`);
      previous = step.run.status;
      if (
        [
          'succeeded',
          'failed',
          'cancelled',
          'timed_out',
          'partially_succeeded',
          'rejected',
          'out_of_scope',
        ].includes(step.run.status)
      )
        break;
      await page.waitForTimeout(5000);
    }
    const eventsText = await (
      await request.get(`${api}/runs/${step.runId}/events`)
    ).text();
    await writeFile(join(directory, `${phase.label}-events.txt`), eventsText);
    await save();
    if (!step.run) throw new Error('RUN_REQUIRED');
    expect(step.run.status, JSON.stringify(step.run)).toBe('succeeded');
    expect(eventsText).toContain('run.delivery.prepared');
    expect(eventsText).toContain('"mode":"indexed"');
    const journal = JSON.parse(
      await readFile(
        join(sourceRoot, `.gamerhub/attempts/${step.runId}.json`),
        'utf8',
      ),
    );
    expect(journal.status).toBe('committed');
    step.journal = journal;
    const game = await context.newPage();
    await game.setViewportSize({ width: 960, height: 600 });
    await game.goto(step.run.result_summary);
    const state = () =>
      game.evaluate(
        () =>
          (
            window as unknown as {
              __gamerhubGameState: {
                phase: string;
                total: number;
                wallet: number;
                specVersionId: string;
              };
            }
          ).__gamerhubGameState,
      );
    await expect
      .poll(async () => (await state())?.phase, { timeout: 150000 })
      .toBe('ready');
    await game.mouse.click(480, 483);
    await expect.poll(async () => (await state()).phase).toBe('playing');
    await game.keyboard.press('b');
    await game.waitForTimeout(250);
    expect((await state()).total).toBe(phase.reward);
    await game.keyboard.press('b');
    await game.waitForTimeout(200);
    expect((await state()).total).toBe(phase.reward);
    await game.mouse.click(500, 407);
    await expect
      .poll(async () => (await state()).total)
      .toBe(phase.reward + 10);
    step.gameplay = await state();
    await game.screenshot({
      path: join(directory, `${phase.label}-gameplay.png`),
    });
    await game.close();
    const scene = await readFile(
      join(sourceRoot, 'Assets/Game/Scenes/Runner.unity'),
    );
    step.sceneHash = createHash('sha256').update(scene).digest('hex');
    if (phase.label === 'created') {
      const sentinel =
        'namespace GamerHub { public static class LocalMaturitySentinel { public const string Value = "preserve-my-code"; } }\n';
      await writeFile(
        join(sourceRoot, 'Assets/Game/Scripts/LocalMaturitySentinel.cs'),
        sentinel,
      );
      evidence.sentinelHash = createHash('sha256')
        .update(sentinel)
        .digest('hex');
    } else {
      expect(step.sceneHash).toBe(evidence.created?.sceneHash);
      const sentinel = await readFile(
        join(sourceRoot, 'Assets/Game/Scripts/LocalMaturitySentinel.cs'),
      );
      expect(createHash('sha256').update(sentinel).digest('hex')).toBe(
        evidence.sentinelHash,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '本次交付已通过验证' }),
    ).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: join(directory, `${phase.label}-workbench.png`),
      fullPage: true,
    });
    step.status = 'passed';
    await save();
  }
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});
