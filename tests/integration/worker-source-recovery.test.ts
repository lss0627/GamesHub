import { InMemoryPlatformStore } from '@gamerhub/domain';
import { expect, it, vi } from 'vitest';
import { OrchestratorWorker } from '../../apps/orchestrator-worker/src/worker';
import { createPlatformApi } from '../../apps/platform-api/src/app';

async function fixture() {
  const store = new InMemoryPlatformStore();
  const project = await store.createProject({
    ownerId: 'u',
    name: 'safe iteration',
    slug: 'safe',
    quotaProfile: 'standard',
  });
  const { run } = await store.createRun({
    ownerId: 'u',
    projectId: project.id,
    requestType: 'create',
    userInput: 'runner',
    idempotencyKey: 'new',
  });
  const api = createPlatformApi({ userId: 'u', role: 'creator' }, { store });
  return {
    store,
    run,
    control: (action: string) =>
      api.request({
        method: 'POST',
        path: `/v1/projects/${project.id}/runs/${run.id}/${action}`,
      }),
  };
}
it.each(['failed', 'cancelled'] as const)(
  'settles %s source under ownership before releasing the run',
  async (outcome) => {
    const { store, run, control } = await fixture();
    const calls: string[] = [];
    const worker = new OrchestratorWorker({
      store,
      workerId: 'worker',
      prepareSource: async () => {
        calls.push('begin');
      },
      settleSource: async (current, status) => {
        calls.push(status);
        expect((await store.getRunForWorker(current.id)).leaseOwner).toBe(
          'worker',
        );
        return { status: 'recovered', archived: true };
      },
      executeTask: async (task) => {
        expect(calls[0]).toBe('begin');
        if (outcome === 'cancelled') await control('cancel');
        return {
          taskId: task.id,
          status: 'failed',
          evidence: [],
          error: {
            code: 'INTENTIONAL_FAILURE',
            message: 'failed',
            retryable: false,
          },
        };
      },
    });
    expect((await worker.processNext())?.status).toBe(outcome);
    expect(calls).toEqual(['begin', outcome]);
    expect((await store.getRunForWorker(run.id)).leaseOwner).toBeUndefined();
  },
);
it('preserves in-progress source on creator pause', async () => {
  const { store, control } = await fixture();
  const settleSource = vi.fn();
  const worker = new OrchestratorWorker({
    store,
    prepareSource: async () => undefined,
    settleSource,
    executeTask: async (task) => {
      await control('pause');
      return {
        taskId: task.id,
        status: 'completed',
        evidence: [{ type: 'schema', reference: 'checked' }],
      };
    },
  });
  expect((await worker.processNext())?.status).toBe('paused');
  expect(settleSource).not.toHaveBeenCalled();
});
it('does not restore source after losing the run lease', async () => {
  const { store, run } = await fixture();
  const settleSource = vi.fn();
  const worker = new OrchestratorWorker({
    store,
    workerId: 'old',
    prepareSource: async () => undefined,
    settleSource,
    executeTask: async (task) => {
      await store.updateRun(run.id, {
        leaseOwner: 'new',
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      return { taskId: task.id, status: 'failed', evidence: [] };
    },
  });
  expect((await worker.processNext())?.status).toBe('interrupted');
  expect(settleSource).not.toHaveBeenCalled();
});
