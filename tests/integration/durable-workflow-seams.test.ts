import { PostgresDomainRepository, type SqlClient } from '@gamerhub/domain';
import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { type PlannerTask, planRunnerTaskGraph } from '@gamerhub/game-planner';
import { GameSpecService, runnerGameSpec } from '@gamerhub/game-spec';
import { PlaytestProtocolClient } from '@gamerhub/playtest';
import { describe, expect, it } from 'vitest';
import { UnityTaskExecutor } from '../../apps/orchestrator-worker/src/executors/unity-task-executor';

describe('durable workflow seams', () => {
  it('hydrates and persists Game Spec versions without changing the sync API', async () => {
    const saved = new Map<
      string,
      ReturnType<GameSpecService['createVersion']>
    >();
    const persistence = {
      async save(version: ReturnType<GameSpecService['createVersion']>) {
        saved.set(version.id, structuredClone(version));
      },
      async activate(_projectId: string, versionId: string) {
        const version = saved.get(versionId);
        if (version) {
          for (const item of saved.values())
            if (
              item.projectId === version.projectId &&
              item.status === 'active'
            )
              item.status = 'superseded';
          version.status = 'active';
        }
      },
      async list(projectId: string) {
        return [...saved.values()]
          .filter((version) => version.projectId === projectId)
          .map((version) => structuredClone(version));
      },
      async findBySourceRun(projectId: string, sourceRunId: string) {
        return [...saved.values()].find(
          (version) =>
            version.projectId === projectId &&
            version.sourceRunId === sourceRunId,
        );
      },
      async findByContentHash(projectId: string, contentHash: string) {
        return [...saved.values()].find(
          (version) =>
            version.projectId === projectId &&
            version.contentHash === contentHash,
        );
      },
    };
    const service = new GameSpecService(persistence);
    const version = await service.createVersionAndPersist({
      projectId: 'project-1',
      sourceRunId: 'run-1',
      spec: runnerGameSpec,
      summary: 'create runner',
    });
    await service.activateAndPersist(version.id);
    const restarted = new GameSpecService(persistence);
    const hydrated = await restarted.listDurably('project-1');
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.status).toBe('active');
    const replayed = await restarted.createVersionAndPersist({
      projectId: 'project-1',
      sourceRunId: 'run-1',
      spec: runnerGameSpec,
      summary: 'create runner',
    });
    expect(replayed.id).toBe(version.id);
    expect(saved).toHaveLength(1);
    const equivalentFromAnotherRun = await restarted.createVersionAndPersist({
      projectId: 'project-1',
      sourceRunId: 'run-2',
      spec: runnerGameSpec,
      summary: 'retry identical runner',
    });
    expect(equivalentFromAnotherRun.id).toBe(version.id);
    expect(saved).toHaveLength(1);
  });

  it('executes curated Game Skill operations through the Unity adapter', async () => {
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      runId: 'run-1',
      gameSpecVersionId: 'spec-1',
      spec: runnerGameSpec,
    });
    const executor = new UnityTaskExecutor({
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/golden/runner',
    });
    const sceneTask = graph.tasks.find((task) => task.id === 'scene-create');
    const publishTask = graph.tasks.find(
      (task) => task.id === 'publish-preview',
    );
    if (!sceneTask || !publishTask) throw new Error('GRAPH_TASKS_REQUIRED');
    const scene = await executor.execute(sceneTask, 'run-1');
    expect(scene.status).toBe('completed');
    expect(scene.evidence.some((item) => item.type === 'engine')).toBe(true);
    const publish = await executor.execute(publishTask, 'run-1');
    expect(publish.status).toBe('completed');
    expect(publish.evidence[0]?.type).toBe('publish-intent');
  });

  it('completes a Probe handshake before executing the playtest timeline', async () => {
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      runId: 'run-1',
      gameSpecVersionId: 'spec-1',
      spec: runnerGameSpec,
    });
    const playtestTask = graph.tasks.find((task) => task.type === 'playtest');
    if (!playtestTask) throw new Error('PLAYTEST_TASK_REQUIRED');
    const probe = new PlaytestProtocolClient({
      projectRevision: 'rev-0',
      gameSpecVersion: 'spec-1',
    });
    const executor = new UnityTaskExecutor({
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/golden/runner',
      probeClient: probe,
      specVersionId: 'spec-1',
      checkpointRef: 'rev-0',
    });

    const result = await executor.execute(playtestTask, 'run-1');

    expect(result.status).toBe('completed');
    expect(result.evidence.some((item) => item.type === 'playtest')).toBe(true);
    expect(probe.executedCommands).toContain('input.jump');
  });

  it('accepts an injected real local Unity playtest without a fixture Probe', async () => {
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      runId: 'run-local-unity',
      gameSpecVersionId: 'spec-1',
      spec: runnerGameSpec,
    });
    const playtestTask = graph.tasks.find((task) => task.type === 'playtest');
    if (!playtestTask) throw new Error('PLAYTEST_TASK_REQUIRED');
    const executor = new UnityTaskExecutor({
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/golden/runner',
      runPlaytest: async ({ runId, task }) => ({
        passed: true,
        evidence: [
          {
            type: 'playtest',
            reference: `unity://playmode/${runId}/${task.id}`,
            contentHash: 'sha256-real-unity-test',
          },
        ],
      }),
    });

    const result = await executor.execute(playtestTask, 'run-local-unity');

    expect(result.status).toBe('completed');
    expect(result.evidence).toEqual([
      expect.objectContaining({
        type: 'playtest',
        reference: expect.stringMatching(/^unity:\/\/playmode\//),
      }),
    ]);
  });

  it('persists injected Unity playtest and evaluation evidence', async () => {
    const statements: string[] = [];
    let persistedTimestampMs: unknown;
    const client: SqlClient = {
      release: () => undefined,
      query: async (text, values) => {
        statements.push(text);
        if (text.includes('INSERT INTO playtest_runs'))
          return { rows: [{ id: 'playtest-1' }] };
        if (text.includes('INSERT INTO playtest_evidence')) {
          persistedTimestampMs = values?.[4];
          return { rows: [{ id: 'evidence-1' }] };
        }
        if (text.includes('INSERT INTO evaluation_reports'))
          return { rows: [{ id: 'evaluation-1' }] };
        return { rows: [] };
      },
    };
    const repository = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      runId: 'run-durable-local-unity',
      gameSpecVersionId: 'spec-1',
      spec: runnerGameSpec,
    });
    const playtestTask = graph.tasks.find((task) => task.type === 'playtest');
    const evaluateTask = graph.tasks.find((task) => task.type === 'evaluate');
    if (!playtestTask || !evaluateTask) throw new Error('TASKS_REQUIRED');
    const executor = new UnityTaskExecutor({
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/golden/runner',
      durableStore: repository,
      projectId: 'project-1',
      specVersionId: 'spec-1',
      runPlaytest: async () => ({
        passed: true,
        evidence: [
          {
            type: 'playtest',
            reference: 'unity://playmode/run-durable-local-unity',
            contentHash: 'sha256-playtest',
          },
        ],
      }),
      evaluate: async () => ({
        passed: true,
        reportKey: 'local/evaluation/sha256-report.json',
        evidence: [
          {
            type: 'evaluation',
            reference: 'unity://evaluation/run-durable-local-unity',
            contentHash: 'sha256-evaluation',
          },
        ],
      }),
    });

    expect(
      (await executor.execute(playtestTask, 'run-durable-local-unity')).status,
    ).toBe('completed');
    expect(
      (await executor.execute(evaluateTask, 'run-durable-local-unity')).status,
    ).toBe('completed');
    expect(
      statements.some((text) => text.includes('INSERT INTO playtest_runs')),
    ).toBe(true);
    expect(
      statements.some((text) => text.includes('INSERT INTO playtest_evidence')),
    ).toBe(true);
    expect(
      statements.some((text) =>
        text.includes('INSERT INTO evaluation_reports'),
      ),
    ).toBe(true);
    expect(persistedTimestampMs).toBe(0);
  });

  it('runs asset tasks through Unity import, compile and Probe validation', async () => {
    class RecordingUnityAdapter extends InMemoryEngineAdapter {
      readonly calls: string[] = [];

      override async execute(
        ...args: Parameters<InMemoryEngineAdapter['execute']>
      ) {
        this.calls.push(args[0].capability);
        return super.execute(...args);
      }

      override async compile(
        ...args: Parameters<InMemoryEngineAdapter['compile']>
      ) {
        this.calls.push('compile');
        return super.compile(...args);
      }
    }

    const adapter = new RecordingUnityAdapter();
    let staged = false;
    let committed = false;
    const probe = new PlaytestProtocolClient({
      projectRevision: 'rev-0',
      gameSpecVersion: 'spec-1',
    });
    const task: PlannerTask = {
      id: 'asset-import',
      type: 'asset',
      description: 'Replace the player character asset',
      dependencies: [],
      status: 'pending',
      retry_count: 0,
      max_retries: 2,
      validation_method: {
        type: 'playtest_assertion',
        reference: 'AssetImportTests.StableLogicalMapping',
      },
      related_files: ['Assets/Game/Art/Player.png'],
      related_scenes: ['runner_scene'],
      capabilities: ['asset.import', 'component.set_property'],
    };
    const executor = new UnityTaskExecutor({
      adapter,
      projectPath: 'D:/golden/runner',
      probeClient: probe,
      specVersionId: 'spec-1',
      checkpointRef: 'rev-0',
      stageAsset: async () => {
        staged = true;
      },
      onAssetImported: async () => {
        committed = true;
      },
    });

    const result = await executor.execute(task, 'run-asset-1');

    expect(result.status).toBe('completed');
    expect(adapter.calls).toContain('asset.import');
    expect(adapter.calls).toContain('component.set_property');
    expect(adapter.calls).toContain('compile');
    expect(probe.executedCommands).toContain('input.jump');
    expect(staged).toBe(true);
    expect(committed).toBe(true);
  });
});
