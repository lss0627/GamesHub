import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

async function main() {
  const original = JSON.parse(
    await readFile('artifacts/guided-flow/cycle.json', 'utf8'),
  );
  const root = `http://127.0.0.1:3001/v1/projects/${original.projectId}`;
  async function api(path: string, body?: unknown) {
    const response = await fetch(
      root + path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    assert(response.ok, JSON.stringify(result));
    return result;
  }
  let design = await api('/design');
  const before = (await api('/runs')).items.length;
  design = await api('/design/messages', {
    revision: design.revision,
    message:
      '试玩后我想让收集更有成就感：请只把每枚金币改成20分，保留60秒、速度5、跳跃7和间隔2.8秒以及原来的美术。这个修改方案我同意，请总结后让我查看制作说明。',
  });
  console.log('MODIFICATION_DISCUSSION', design.messages.at(-1).content);
  assert.equal(design.spec, undefined);
  assert.equal((await api('/runs')).items.length, before);
  design = await api('/design/prepare', { revision: design.revision });
  assert.equal(design.brief.coinScore, 20);
  assert.equal(design.brief.jump, 7);
  assert.equal(design.brief.duration, 60);
  assert.equal(design.brief.speed, 5);
  assert.equal(design.brief.interval, 2.8);
  const reviewed = design.spec;
  design = await api('/design/confirm', { revision: design.revision });
  const evidence = {
    projectId: original.projectId,
    reviewed,
    design,
    run: null as unknown,
  };
  await writeFile(
    'artifacts/guided-flow/creation.json',
    JSON.stringify(original, null, 2),
  );
  await writeFile(
    'artifacts/guided-flow/modification.json',
    JSON.stringify(evidence, null, 2),
  );
  let previous = '';
  for (let i = 0; i < 180; i++) {
    const run = await api(`/runs/${design.confirmedRunId}`);
    if (run.status !== previous) {
      console.log('MODIFY_RUN', run.status, run.result_summary ?? '');
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
        'artifacts/guided-flow/modification.json',
        JSON.stringify(evidence, null, 2),
      );
      assert.equal(run.status, 'succeeded', JSON.stringify(run));
      assert.equal(run.request_type, 'modify');
      await writeFile(
        'artifacts/guided-flow/cycle.json',
        JSON.stringify(evidence, null, 2),
      );
      console.log('GUIDED_MODIFICATION_PASSED');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('MODIFY_TIMEOUT');
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
