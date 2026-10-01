import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { planModification } from '@gamerhub/game-planner';
import { expect, it, vi } from 'vitest';
import { UnityTaskExecutor } from '../../apps/orchestrator-worker/src/executors/unity-task-executor';

it('imports all bound Resources sprites and validates through real-playtest callback', async () => {
  const adapter = new InMemoryEngineAdapter();
  const execute = vi.spyOn(adapter, 'execute');
  const paths = ['cat', 'forest', 'coin', 'stump'].map(
    (role) => `Assets/Resources/Art/${role}.png`,
  );
  const runPlaytest = vi.fn(async () => ({ passed: true, evidence: [] }));
  const task = planModification({
    projectId: 'p',
    runId: 'r',
    specVersionId: 's',
    changedPaths: ['/assets/0/asset_id'],
  }).tasks[0];
  const executor = new UnityTaskExecutor({
    adapter,
    projectPath: 'project',
    resourceAssetPaths: paths,
    runPlaytest,
  });
  expect((await executor.execute(task, 'r')).status).toBe('completed');
  expect(
    execute.mock.calls
      .filter(([command]) => command.capability === 'asset.import')
      .map(([command]) => command.arguments.path),
  ).toEqual(paths);
  expect(
    execute.mock.calls.some(
      ([command]) => command.capability === 'component.set_property',
    ),
  ).toBe(false);
  expect(runPlaytest).toHaveBeenCalledOnce();
});

it('restores imported resource files when the engine playtest gate fails', async () => {
  const rollbackAsset = vi.fn(async () => undefined);
  const onAssetImported = vi.fn(async () => undefined);
  const task = planModification({
    projectId: 'p',
    runId: 'r',
    specVersionId: 's',
    changedPaths: ['/assets/0/asset_id'],
  }).tasks[0];
  const executor = new UnityTaskExecutor({
    adapter: new InMemoryEngineAdapter(),
    projectPath: 'project',
    resourceAssetPaths: ['Assets/Resources/Art/cat.png'],
    runPlaytest: async () => ({ passed: false, evidence: [] }),
    rollbackAsset,
    onAssetImported,
  });
  expect((await executor.execute(task, 'r')).status).toBe('failed');
  expect(rollbackAsset).toHaveBeenCalledOnce();
  expect(onAssetImported).not.toHaveBeenCalled();
});
