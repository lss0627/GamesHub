import { InMemoryPlatformStore } from '@gamerhub/domain';
import { expect, it } from 'vitest';
import { createLocalTaskExecutor } from '../../apps/local-dev/src/server';
import { OrchestratorWorker } from '../../apps/orchestrator-worker/src/worker';
import { createPlatformApi } from '../../apps/platform-api/src/app';

it('projects committed matching delivery evidence and protects it from other tenants', async () => {
  const store = new InMemoryPlatformStore();
  const project = await store.createProject({
    ownerId: 'owner',
    name: 'delivery',
    slug: 'delivery',
    quotaProfile: 'standard',
  });
  const { run } = await store.createRun({
    ownerId: 'owner',
    projectId: project.id,
    requestType: 'create',
    userInput: 'runner',
    idempotencyKey: 'delivery-1',
  });
  const fixture = createLocalTaskExecutor();
  const worker = new OrchestratorWorker({
    store,
    taskExecutorFactory: async () => ({
      execute: async (task, runId, trace) => {
        const result = await fixture.execute(task, runId, trace);
        return {
          ...result,
          ...(task.type === 'test'
            ? {
                verification: [
                  {
                    suite: 'GamerHub.Generated.dashTests',
                    mode: 'indexed' as const,
                    passed: 2,
                    failed: 0,
                    reportHash: `sha256-${'a'.repeat(64)}`,
                    criteria: [
                      {
                        id: 'dash.01',
                        description: '冲刺移动',
                        status: 'passed' as const,
                        caseCount: 1,
                      },
                    ],
                    internalPath: 'D:/private/project.xml',
                  },
                ],
              }
            : {}),
        };
      },
    }),
    publishPreview: async (input) => ({
      healthy: true,
      url: 'http://localhost/preview',
      buildHash: input.buildHash,
      browser: {
        passed: true,
        buildHash: input.buildHash,
        specVersionId: input.specVersionId ?? 'MISSING_SPEC',
        runId: input.runId,
        reportHash: `sha256-${'b'.repeat(64)}`,
        checks: [
          'load-and-identity',
          'visible-canvas',
          'start',
          'pause-and-resume',
          'core-interaction',
          'runtime-errors',
        ].map((id) => ({ id, status: 'passed' as const, durationMs: 10 })),
      },
      evidence: [{ type: 'preview', reference: 'fixture://preview' }],
    }),
  });
  expect((await worker.processNext())?.status).toBe('succeeded');
  const events = await store.replayEvents(run.id, 0);
  const delivery = events.find(
    (entry) => entry.eventType === 'run.delivery.prepared',
  );
  expect(delivery?.payload).toMatchObject({
    runId: run.id,
    tests: [expect.objectContaining({ mode: 'indexed' })],
    browser: { passed: true },
  });
  expect(JSON.stringify(delivery?.payload)).not.toContain('private');
  expect(delivery?.sequence).toBeLessThan(
    events.find((entry) => entry.eventType === 'run.succeeded')?.sequence ?? 0,
  );
  const api = createPlatformApi(
    { userId: 'intruder', role: 'creator' },
    { store },
  );
  const denied = await api.request({
    method: 'GET',
    path: `/v1/projects/${project.id}/runs/${run.id}/events`,
  });
  expect(denied.status).toBe(404);
});
