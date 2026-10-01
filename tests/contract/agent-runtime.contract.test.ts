import { InMemoryAgentRuntime } from '@gamerhub/agent-runtime';
import { describe, expect, it } from 'vitest';

const input = {
  runId: 'run-1',
  sessionId: 'session-1',
  prompt: 'create a runner',
  workspaceRef: 'workspace-1',
  modelRole: 'planner' as const,
  allowedToolNames: ['game.spec.read'],
  allowedSkillNames: [],
  contextSnapshot: { schemaVersion: '1.0.0', values: {} },
  signal: new AbortController().signal,
};

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('AgentRuntime contract', () => {
  it('creates a platform session idempotently and keeps the vendor reference opaque', async () => {
    const runtime = new InMemoryAgentRuntime();
    const first = await runtime.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      runtimeType: 'test',
    });
    const second = await runtime.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      runtimeType: 'test',
    });
    expect(second).toEqual(first);
    expect(first.runtimeSessionRef).not.toContain('project-1');
  });

  it('orders, deduplicates and resumes committed events', async () => {
    const runtime = new InMemoryAgentRuntime();
    await runtime.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      runtimeType: 'test',
    });
    const events = await collect(runtime.runTask(input));
    expect(events.length).toBeGreaterThan(1);
    expect(events.map((event) => event.sequence)).toEqual(
      [...events]
        .sort((a, b) => a.sequence - b.sequence)
        .map((event) => event.sequence),
    );
    const resumed = await collect(
      runtime.resumeTask({
        ...input,
        afterEventSequence: events[0]?.sequence ?? 0,
      }),
    );
    expect(
      resumed.every((event) => event.sequence > (events[0]?.sequence ?? 0)),
    ).toBe(true);
  });

  it('pauses at a safe boundary and cancellation is idempotent', async () => {
    const runtime = new InMemoryAgentRuntime();
    await runtime.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      runtimeType: 'test',
    });
    const paused = await runtime.pauseTask({
      runId: 'run-1',
      reason: 'creator requested pause',
    });
    expect(paused.status).toBe('paused');
    expect(paused.releasedExclusiveResources).toBe(true);
    await expect(
      runtime.cancelTask({ runId: 'run-1', reason: 'cleanup' }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await expect(
      runtime.cancelTask({ runId: 'run-1', reason: 'cleanup again' }),
    ).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('rejects tools that are not registered or allowed for the task', async () => {
    const runtime = new InMemoryAgentRuntime();
    await runtime.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      runtimeType: 'test',
    });
    await expect(
      collect(
        runtime.runTask({ ...input, allowedToolNames: ['not-registered'] }),
      ),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
  });
});
