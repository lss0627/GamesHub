import { InMemoryPlatformStore } from '@gamerhub/domain';
import { describe, expect, it } from 'vitest';
import { RunEventAgentCheckpointStore } from '../../apps/orchestrator-worker/src/runtime/run-event-agent';

describe('Run event Agent checkpoint persistence', () => {
  it('round-trips a checkpoint through the platform Run event stream', async () => {
    const store = new InMemoryPlatformStore();
    const project = await store.createProject({
      ownerId: 'owner-1',
      name: 'Agent recovery',
      slug: 'agent-recovery',
      quotaProfile: 'starter',
    });
    const { run } = await store.createRun({
      ownerId: 'owner-1',
      projectId: project.id,
      requestType: 'create',
      userInput: 'create a runner',
      idempotencyKey: 'agent-checkpoint-1',
      sessionId: 'session-1',
    });
    const checkpoints = new RunEventAgentCheckpointStore(store);
    await checkpoints.save({
      schemaVersion: '1.0.0',
      runId: run.id,
      sessionId: run.sessionId,
      policyFingerprint: 'policy-1',
      status: 'running',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:01.000Z',
      usage: { steps: 1, toolCalls: 1, retries: 0 },
      actions: {
        scene: {
          actionId: 'scene',
          idempotencyKey: 'scene',
          toolName: 'unity.task.execute',
          toolVersion: '1.0.0',
          status: 'completed',
          attempts: 1,
          startedAt: '2026-09-05T00:00:00.000Z',
          updatedAt: '2026-09-05T00:00:01.000Z',
          output: { status: 'completed' },
        },
      },
    });

    await expect(checkpoints.load(run.id)).resolves.toMatchObject({
      runId: run.id,
      usage: { toolCalls: 1 },
      actions: { scene: { status: 'completed' } },
    });
    const events = await store.replayEvents(run.id, 0);
    expect(events.at(-1)?.eventType).toBe('agent.checkpoint');
    expect(events.at(-1)?.visibility).toBe('developer');
  });
});
