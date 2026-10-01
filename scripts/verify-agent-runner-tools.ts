import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { UnityEngineAdapter } from '@gamerhub/unity-adapter';
import { gameConfigFromSpec } from '../apps/local-dev/src/real-unity';
import { planGameTaskGraph } from '../packages/game-planner/src/planner';
import { buildDesignSpec, initialBrief } from '../packages/game-spec/src';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
async function main() {
  assert.equal(process.env.GAMERHUB_REAL_FLOW, '1');
  assert.ok(process.env.UNITY_EDITOR_PATH);
  const root = resolve('unity/Acceptance/AgentMaturityRunner');
  const evidenceDirectory = resolve('artifacts/agent-maturity/runner-tools');
  await mkdir(evidenceDirectory, { recursive: true });
  for (const name of ['Assets', 'Packages', 'ProjectSettings'])
    await cp(resolve('unity/Templates/Runner', name), join(root, name), {
      recursive: true,
      force: true,
    });
  const spec = buildDesignSpec({ ...initialBrief, genre: 'runner' });
  const graph = planGameTaskGraph({
    projectId: 'runner-tools',
    runId: 'runner-tools',
    gameSpecVersionId: 'runner-tools',
    spec,
  });
  assert.equal(graph.tasks.length, 7);
  await writeFile(
    join(root, 'Assets/Resources/GamerHubGameConfig.json'),
    JSON.stringify(gameConfigFromSpec(spec, 'runner-tools')),
  );
  const adapter = new UnityEngineAdapter({
    editorPath: process.env.UNITY_EDITOR_PATH,
    projectPath: root,
    requireBatchmode: true,
  });
  const context = {
    runId: 'runner-tools',
    taskId: 'runtime-compose',
    workspaceRoot: root,
    capabilities: ['scene.create', 'test', 'component.set_property'],
  };
  const capabilities = await adapter.discoverCapabilities();
  assert.ok(!capabilities.commands.includes('game_object.create'));
  console.log('Actual Runner runtime composition started');
  const composed = await adapter.execute(
    {
      commandId: 'compose',
      capability: 'scene.create',
      safetyClass: 'project_write',
      projectRef: 'runner-tools',
      arguments: {},
      timeoutMs: 600000,
    },
    context,
  );
  await writeFile(
    join(evidenceDirectory, 'compose.json'),
    JSON.stringify(composed, null, 2),
  );
  assert.equal(composed.status, 'succeeded');
  const scene = await readFile(
    join(root, 'Assets/Game/Scenes/Runner.unity'),
    'utf8',
  );
  assert.ok(scene.includes('GameObject:'));
  console.log('Actual Runner tests started');
  const tested = await adapter.execute(
    {
      commandId: 'tests',
      capability: 'test',
      safetyClass: 'runtime',
      projectRef: 'runner-tools',
      arguments: { mode: 'playmode', filter: 'RunnerPlayModeTests' },
      timeoutMs: 300000,
    },
    context,
  );
  await writeFile(
    join(evidenceDirectory, 'tests.json'),
    JSON.stringify(tested, null, 2),
  );
  assert.equal(tested.status, 'succeeded');
  assert.ok(tested.output.testReport);
  const rejected = await adapter.execute(
    {
      commandId: 'unsupported-property',
      capability: 'component.set_property',
      safetyClass: 'project_write',
      projectRef: 'runner-tools',
      arguments: {
        assetPath: 'Assets/Game/Scenes/Runner.unity',
        property: 'unsupportedField',
        value: '10',
      },
      timeoutMs: 180000,
    },
    context,
  );
  await writeFile(
    join(evidenceDirectory, 'rejected-property.json'),
    JSON.stringify(rejected, null, 2),
  );
  assert.equal(rejected.status, 'failed');
  assert.equal(
    await readFile(join(root, 'Assets/Game/Scenes/Runner.unity'), 'utf8'),
    scene,
  );
  await writeFile(
    join(evidenceDirectory, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        capabilities,
        graph,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    'Actual composition, NUnit evidence and unsupported property rejection passed',
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
