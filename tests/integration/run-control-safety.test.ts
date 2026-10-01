import { InMemoryPlatformStore } from '@gamerhub/domain';
import { describe, expect, it, vi } from 'vitest';
import { createRunEventAgentKernel } from '../../apps/orchestrator-worker/src/runtime/run-event-agent';
import { OrchestratorWorker } from '../../apps/orchestrator-worker/src/worker';
import { createPlatformApi } from '../../apps/platform-api/src/app';

async function setup() {
  const store = new InMemoryPlatformStore();
  const project = await store.createProject({
    ownerId: 'user',
    name: 'Runner',
    slug: 'runner',
    quotaProfile: 'standard',
  });
  const { run } = await store.createRun({
    ownerId: 'user',
    projectId: project.id,
    requestType: 'create',
    userInput: 'runner',
    idempotencyKey: 'first',
  });
  const api = createPlatformApi({ userId: 'user', role: 'creator' }, { store });
  const control = (action: string) =>
    api.request({
      method: 'POST',
      path: `/v1/projects/${project.id}/runs/${run.id}/${action}`,
    });
  return { store, project, run, control };
}

describe('worker control safety', () => {
  it.each(['succeeded', 'failed'] as const)(
    'commits %s before optional diagnostic finalization',
    async (status) => {
      const { store, run } = await setup();
      const agentKernel = createRunEventAgentKernel(store);
      let statusAtFinalization: string | undefined;
      const finalize = vi
        .spyOn(agentKernel, 'finalize')
        .mockImplementation(async () => {
          statusAtFinalization = (await store.getRunForWorker(run.id)).status;
          throw new Error('DIAGNOSTIC_SINK_UNAVAILABLE');
        });
      const worker = new OrchestratorWorker({
        store,
        agentKernel,
        executeTask: async (task) => ({
          taskId: task.id,
          status: status === 'succeeded' ? 'completed' : 'failed',
          evidence: [
            'schema',
            'engine',
            'test',
            'playtest',
            'evaluation',
            'build',
          ].map((type) => ({
            type,
            reference: 'audit://verified',
            contentHash: 'sha256-real-build',
          })),
        }),
        publishPreview: async ({ buildHash }) => {
          expect(buildHash).toBe('sha256-real-build');
          return {
            healthy: true,
            url: 'https://preview.example/game',
            buildHash,
          };
        },
      });
      expect((await worker.processNext())?.status).toBe(status);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(statusAtFinalization).toBe(status);
      expect(await store.getRunForWorker(run.id)).toMatchObject({
        status,
        leaseOwner: undefined,
      });
    },
  );

  it('serializes legacy queued runs per project and respects a paused sibling', async () => {
    const { store, run } = await setup();
    const snapshot = store.snapshot();
    snapshot.runs.push({ ...run, id: 'legacy-run', idempotencyKey: 'legacy' });
    const recovered = new InMemoryPlatformStore(snapshot);
    const claims = await Promise.all([
      recovered.claimNextRun('one'),
      recovered.claimNextRun('two'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await recovered.updateRun(run.id, {
      status: 'paused',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    expect(await recovered.claimNextRun('three')).toBeUndefined();
    await recovered.updateRun(run.id, { status: 'cancelled' });
    expect((await recovered.claimNextRun('three'))?.id).toBe('legacy-run');
  });

  it('preserves cancellation during an in-flight tool and never publishes', async () => {
    const { store, run, control } = await setup();
    const publishPreview = vi.fn();
    const executeTask = vi.fn(async (task) => {
      expect((await control('cancel')).status).toBe(202);
      return {
        taskId: task.id,
        status: 'completed' as const,
        evidence: [{ type: 'schema', reference: 'verified' }],
      };
    });
    const worker = new OrchestratorWorker({
      store,
      executeTask,
      publishPreview,
    });
    expect((await worker.processNext())?.status).toBe('cancelled');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(publishPreview).not.toHaveBeenCalled();
    expect(await store.getRunForWorker(run.id)).toMatchObject({
      status: 'cancelled',
      leaseOwner: undefined,
    });
    expect(
      (await store.replayEvents(run.id, 0)).some(
        (event) => event.eventType === 'run.failed',
      ),
    ).toBe(false);
  });

  it('acknowledges pause only after the current tool and replays it on resume', async () => {
    const { store, run, control } = await setup();
    const executeTask = vi.fn(async (task) => {
      if (executeTask.mock.calls.length === 1) {
        expect((await control('pause')).body).toMatchObject({
          status: 'pause_requested',
        });
        expect((await control('resume')).status).toBe(409);
      }
      return {
        taskId: task.id,
        status: 'completed' as const,
        evidence: [{ type: 'schema', reference: task.id }],
      };
    });
    const worker = new OrchestratorWorker({ store, executeTask });
    expect((await worker.processNext())?.status).toBe('paused');
    expect(executeTask).toHaveBeenCalledTimes(1);
    expect(await store.getRunForWorker(run.id)).toMatchObject({
      status: 'paused',
      leaseOwner: undefined,
    });
    expect((await control('resume')).status).toBe(202);
    await worker.processNext();
    const ids = executeTask.mock.calls.map(([task]) => task.id);
    expect(ids.filter((id) => id === ids[0])).toHaveLength(1);
  });

  it('renews a lease during a long tool so another worker cannot reclaim it', async () => {
    vi.useFakeTimers();
    try {
      const { store, run, control } = await setup();
      let release: (() => void) | undefined;
      const executeTask = vi.fn(async (task) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          taskId: task.id,
          status: 'completed' as const,
          evidence: [{ type: 'schema', reference: 'verified' }],
        };
      });
      const worker = new OrchestratorWorker({
        store,
        workerId: 'first-worker',
        leaseSeconds: 3,
        executeTask,
      });
      const pending = worker.processNext();
      await vi.advanceTimersByTimeAsync(0);
      expect(executeTask).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await store.claimNextRun('other-worker')).toBeUndefined();
      expect((await store.getRunForWorker(run.id)).leaseOwner).toBe(
        'first-worker',
      );
      await control('cancel');
      release?.();
      expect((await pending)?.status).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects stale-owner writes after lease recovery', async () => {
    const { store, run } = await setup();
    await store.claimNextRun('old');
    await store.updateRun(run.id, {
      leaseExpiresAt: new Date(0).toISOString(),
    });
    expect((await store.claimNextRun('new'))?.leaseOwner).toBe('new');
    await expect(
      store.updateRun(run.id, { leaseOwner: undefined }, 'old'),
    ).rejects.toMatchObject({ code: 'RUN_LEASE_LOST' });
    await expect(
      store.transitionRun(
        run.id,
        'failed',
        { visibility: 'creator', payload: {} },
        'old',
      ),
    ).rejects.toMatchObject({ code: 'RUN_LEASE_LOST' });
  });
});
