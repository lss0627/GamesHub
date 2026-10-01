import {
  InMemoryPlatformStore,
  PostgresDomainRepository,
  type SqlClient,
} from '@gamerhub/domain';
import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { planRunnerTaskGraph } from '@gamerhub/game-planner';
import { runnerGameSpec } from '@gamerhub/game-spec';
import { PlaytestProtocolClient } from '@gamerhub/playtest';
import { describe, expect, it, vi } from 'vitest';
import { UnityTaskExecutor } from '../../apps/orchestrator-worker/src/executors/unity-task-executor';
import { RunEventAgentCheckpointStore } from '../../apps/orchestrator-worker/src/runtime/run-event-agent';
import { OrchestratorWorker } from '../../apps/orchestrator-worker/src/worker';
import { modifyGameWorkflow } from '../../apps/orchestrator-worker/src/workflows/modify-game';
import { createPlatformApi } from '../../apps/platform-api/src/app';

async function setup() {
  const store = new InMemoryPlatformStore();
  const project = await store.createProject({
    ownerId: 'user',
    name: 'Recovery',
    slug: 'recovery',
    quotaProfile: 'standard',
  });
  const { run } = await store.createRun({
    ownerId: 'user',
    projectId: project.id,
    requestType: 'create',
    userInput: 'runner',
    idempotencyKey: 'recovery',
  });
  const api = createPlatformApi({ userId: 'user', role: 'creator' }, { store });
  const control = (action: string) =>
    api.request({
      method: 'POST',
      path: `/v1/projects/${project.id}/runs/${run.id}/${action}`,
    });
  return { store, run, control };
}

const graph = planRunnerTaskGraph({
  projectId: 'project',
  runId: 'run',
  gameSpecVersionId: 'spec',
  spec: runnerGameSpec,
});
function task(type: string) {
  const found = graph.tasks.find((item) => item.type === type);
  if (!found) throw new Error('TEST_TASK_REQUIRED');
  return structuredClone(found);
}

describe('agent recovery boundaries', () => {
  it('retains the durable playtest identity for the Probe path too', async () => {
    const client: SqlClient = {
      release: () => undefined,
      query: async () => ({ rows: [{ id: 'probe-durable' }] }),
    };
    const durableStore = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });
    const executor = new UnityTaskExecutor({
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/runner',
      projectId: 'project',
      specVersionId: 'spec',
      checkpointRef: 'rev',
      durableStore,
      probeClient: new PlaytestProtocolClient({
        projectRevision: 'rev',
        gameSpecVersion: 'spec',
      }),
    });
    expect(await executor.execute(task('playtest'), 'run')).toMatchObject({
      status: 'completed',
      durablePlaytestRunId: 'probe-durable',
    });
  });

  it('does not leak arbitrary exception messages into creator events', async () => {
    const adapter = new InMemoryEngineAdapter();
    vi.spyOn(adapter, 'buildWeb').mockRejectedValue(
      Object.assign(new Error('token=secret D:/private/session'), {
        code: 'ENGINE_TIMEOUT',
      }),
    );
    const result = await new UnityTaskExecutor({
      adapter,
      projectPath: 'D:/runner',
    }).execute(task('build'), 'run');
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('restores persisted playtest identity and evidence into a fresh executor', async () => {
    const client: SqlClient = {
      release: () => undefined,
      query: async (sql) => ({
        rows: [
          {
            id: sql.includes('playtest_runs') ? 'playtest-durable' : 'evidence',
          },
        ],
      }),
    };
    const durableStore = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });
    const evidence = [
      { type: 'playtest', reference: 'unity://verified', contentHash: 'hash' },
    ];
    const runPlaytest = vi.fn(async () => ({ passed: true, evidence }));
    const evaluate = vi.fn(async () => ({
      passed: true,
      evidence: [],
      reportKey: 'evaluation/report.json',
    }));
    const options = {
      adapter: new InMemoryEngineAdapter(),
      projectPath: 'D:/runner',
      projectId: 'project',
      specVersionId: 'spec',
      durableStore,
      runPlaytest,
      evaluate,
    };
    const output = await new UnityTaskExecutor(options).execute(
      task('playtest'),
      'run',
    );
    expect(output).toMatchObject({
      status: 'completed',
      durablePlaytestRunId: 'playtest-durable',
    });
    const restarted = new UnityTaskExecutor(options);
    restarted.restoreResult(task('playtest'), 'run', structuredClone(output));
    expect((await restarted.execute(task('evaluate'), 'run')).status).toBe(
      'completed',
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ evidence }),
    );
    expect(runPlaytest).toHaveBeenCalledTimes(1);
  });

  it('hydrates a replayed task before executing the next task after resume', async () => {
    const { store, control } = await setup();
    const completed = vi.fn(async (current) => {
      await control('pause');
      return {
        taskId: current.id,
        status: 'completed' as const,
        evidence: [{ type: 'schema', reference: 'verified' }],
      };
    });
    expect(
      (
        await new OrchestratorWorker({
          store,
          taskExecutor: { execute: completed },
        }).processNext()
      )?.status,
    ).toBe('paused');
    await control('resume');
    const restoreResult = vi.fn();
    const execute = vi.fn(async (current) => {
      expect(restoreResult).toHaveBeenCalledTimes(1);
      await control('cancel');
      return { taskId: current.id, status: 'completed' as const, evidence: [] };
    });
    await new OrchestratorWorker({
      store,
      taskExecutor: { execute, restoreResult },
    }).processNext();
    expect(restoreResult).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('refuses to repeat an interrupted mutation with unknown partial effects', async () => {
    const { store, run, control } = await setup();
    const execute = vi.fn(async (current) => {
      if (current.type !== 'spec') await control('pause');
      return {
        taskId: current.id,
        status: 'completed' as const,
        evidence: [{ type: 'schema', reference: 'verified' }],
      };
    });
    expect(
      (
        await new OrchestratorWorker({
          store,
          taskExecutor: { execute },
        }).processNext()
      )?.status,
    ).toBe('paused');
    const checkpoints = new RunEventAgentCheckpointStore(store);
    const checkpoint = await checkpoints.load(run.id);
    if (!checkpoint) throw new Error('CHECKPOINT_REQUIRED');
    const mutation = Object.values(checkpoint.actions).at(-1);
    if (!mutation) throw new Error('ACTION_REQUIRED');
    mutation.status = 'running';
    delete mutation.output;
    await checkpoints.save(checkpoint);
    const count = execute.mock.calls.length;
    await control('resume');
    const result = await new OrchestratorWorker({
      store,
      taskExecutor: { execute },
    }).processNext();
    expect(result?.failureCode).toBe('RECOVERY_REQUIRES_RECONCILIATION');
    expect(execute).toHaveBeenCalledTimes(count);
  });

  it('finalizes cancellation only after the in-flight operation finishes', async () => {
    const { store, run, control } = await setup();
    const worker = new OrchestratorWorker({
      store,
      executeTask: async (current) => {
        await control('cancel');
        expect((await store.getRunForWorker(run.id)).leaseOwner).toBeTruthy();
        return { taskId: current.id, status: 'completed', evidence: [] };
      },
    });
    expect((await worker.processNext())?.status).toBe('cancelled');
    const checkpoint = await new RunEventAgentCheckpointStore(store).load(
      run.id,
    );
    expect(checkpoint?.status).toBe('cancelled');
    expect(
      (await store.replayEvents(run.id, 0)).some(
        (event) => event.eventType === 'agent.run.cancelled',
      ),
    ).toBe(true);
  });

  it('retains safe engine failure diagnostics and hides raw process output', async () => {
    const adapter = new InMemoryEngineAdapter();
    vi.spyOn(adapter, 'buildWeb').mockResolvedValue({
      operationId: 'failed',
      status: 'failed',
      changedFiles: [],
      warnings: [],
      errors: [
        {
          code: 'ENGINE_TIMEOUT',
          message: 'Unity batchmode exceeded its deadline',
          severity: 'error',
          details: { token: 'secret' },
        },
      ],
      output: { stderr: 'secret' },
      retryable: true,
      evidenceRefs: [],
      artifactPath: '',
      contentHash: '',
      provenance: {},
    });
    const executor = new UnityTaskExecutor({
      adapter,
      projectPath: 'D:/runner',
    });
    const result = await executor.execute(task('build'), 'run');
    expect(result.error).toMatchObject({
      code: 'ENGINE_TIMEOUT',
      message: 'Unity batchmode exceeded its deadline',
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('preserves the failed modification task reason and emits failed progress', async () => {
    const onProgress = vi.fn();
    const result = await modifyGameWorkflow({
      projectId: 'project',
      runId: 'run',
      specVersionId: 'spec',
      currentRevision: 'rev',
      changedPaths: ['/player/movement/jump_height'],
      executeTask: async () => ({
        status: 'failed',
        evidence: [],
        error: {
          code: 'ENGINE_TIMEOUT',
          message: 'Unity batchmode exceeded its deadline',
        },
      }),
      onProgress,
    });
    expect(result).toMatchObject({
      failureCode: 'ENGINE_TIMEOUT',
      failureMessage: 'Unity batchmode exceeded its deadline',
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
