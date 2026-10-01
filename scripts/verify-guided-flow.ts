import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

async function main() {
  await mkdir('artifacts/guided-flow', { recursive: true });
  const origin = 'http://127.0.0.1:3001';
  async function api(path: string, body?: unknown) {
    const response = await fetch(
      origin + path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  }
  const projects = (await api('/v1/projects')).items;
  const project =
    [...projects].reverse().find((p) => p.name === '森林创作 · 小白引导验收') ??
    (await api('/v1/projects', { name: '森林创作 · 小白引导验收' }));
  const root = `/v1/projects/${project.id}`;
  let design = await api(`${root}/design`);
  for (const message of [
    '我是小白，想做一个轻松的猫咪森林跑酷。先告诉我怎么玩，帮我一起敲定方案。',
    '我希望一局60秒，容易上手，移动速度5，跳跃力度7，生成间隔2.8秒，每个金币10分。用围巾橘猫、森林背景和木桩，我同意这个方案，请总结制作前要确认的内容。',
  ]) {
    if (design.messages.some((m) => m.role === 'user' && m.content === message))
      continue;
    console.log('DISCUSS', message);
    design = await api(`${root}/design/messages`, {
      revision: design.revision,
      message,
    });
    console.log('REPLY', design.messages.at(-1).content);
    assert.equal(
      (await api(`${root}/runs`)).items.length,
      0,
      'chat must never create a run',
    );
  }
  design = await api(`${root}/design/prepare`, { revision: design.revision });
  assert(design.markdown.includes('制作说明'));
  assert.equal(
    (await api(`${root}/runs`)).items.length,
    0,
    'preparing must never create a run',
  );
  const reviewed = design.spec;
  const revision = design.revision;
  design = await api(`${root}/design/confirm`, { revision });
  const retry = await api(`${root}/design/confirm`, { revision });
  assert.equal(retry.confirmedRunId, design.confirmedRunId);
  assert.equal((await api(`${root}/runs`)).items.length, 1);
  const evidence = {
    projectId: project.id,
    reviewed,
    design,
    run: null as unknown,
  };
  await writeFile(
    'artifacts/guided-flow/cycle.json',
    JSON.stringify(evidence, null, 2),
  );
  console.log('CONFIRMED', project.id, design.confirmedRunId);
  let previous = '';
  for (let i = 0; i < 180; i++) {
    const run = await api(`${root}/runs/${design.confirmedRunId}`);
    if (run.status !== previous) {
      console.log('RUN', run.status, run.result_summary ?? '');
      previous = run.status;
    }
    if (
      [
        'succeeded',
        'failed',
        'cancelled',
        'timed_out',
        'partially_succeeded',
      ].includes(run.status)
    ) {
      evidence.run = run;
      await writeFile(
        'artifacts/guided-flow/cycle.json',
        JSON.stringify(evidence, null, 2),
      );
      assert.equal(run.status, 'succeeded', JSON.stringify(run));
      console.log('GUIDED_FLOW_PASSED', project.id);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('RUN_TIMEOUT');
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
