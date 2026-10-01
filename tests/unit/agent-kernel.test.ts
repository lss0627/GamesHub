import {
  AgentKernel,
  type AgentKernelPolicy,
  type AgentKernelTool,
  AgentRuntimeError,
  InMemoryAgentCheckpointStore,
  InMemoryAgentEventSink,
} from '@gamerhub/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

const policy: AgentKernelPolicy = {
  allowedToolNames: ['unity.task.execute'],
  allowedSafetyClasses: ['engine_mutation'],
  budget: {
    maxSteps: 4,
    maxToolCalls: 4,
    maxRetriesPerAction: 1,
    deadlineMs: 60_000,
  },
};

function tool(
  invoke: AgentKernelTool<{ taskId: string }, { status: string }>['invoke'],
  idempotent = true,
): AgentKernelTool<{ taskId: string }, { status: string }> {
  return {
    name: 'unity.task.execute',
    version: '1.0.0',
    safetyClass: 'engine_mutation',
    idempotent,
    invoke,
  };
}

function action(
  definition: AgentKernelTool<{ taskId: string }, { status: string }>,
  id = 'scene',
) {
  return {
    id,
    idempotencyKey: `run-1:${id}`,
    input: { taskId: id },
    tool: definition,
    assess: (output: { status: string }) => ({
      succeeded: output.status === 'completed',
      code: 'UNITY_TASK_FAILED',
    }),
  };
}

describe('AgentKernel', () => {
  it('waits for a timed-out mutation to stop before returning or retrying', async () => {
    vi.useFakeTimers();
    try {
      const kernel = new AgentKernel({
        checkpointStore: new InMemoryAgentCheckpointStore(),
        eventSink: new InMemoryAgentEventSink(),
      });
      let release: (() => void) | undefined;
      const invoke = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 'completed' };
      });
      let settled = false;
      const pending = kernel
        .executeAction({
          runId: 'timeout-run',
          sessionId: 'session',
          policy: {
            ...policy,
            budget: { ...policy.budget, maxRetriesPerAction: 0 },
          },
          action: action({ ...tool(invoke), timeoutMs: 10 }),
        })
        .then(
          () => {
            settled = true;
            return '';
          },
          (error) => {
            settled = true;
            return error.code;
          },
        );
      await vi.advanceTimersByTimeAsync(20);
      expect(settled).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(1);
      release?.();
      expect(await pending).toBe('TOOL_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });
  it('executes an allowed Unity action and replays its durable result', async () => {
    const checkpoints = new InMemoryAgentCheckpointStore();
    const events = new InMemoryAgentEventSink();
    const kernel = new AgentKernel({
      checkpointStore: checkpoints,
      eventSink: events,
    });
    const invoke = vi.fn(async () => ({ status: 'completed' }));
    const input = {
      runId: 'run-1',
      sessionId: 'session-1',
      policy,
      action: action(tool(invoke)),
    };

    const first = await kernel.executeAction(input);
    const replay = await kernel.executeAction(input);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.output).toEqual({ status: 'completed' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent.run.started',
        'agent.plan.action_ready',
        'agent.act.started',
        'agent.observe.completed',
        'agent.action.replayed',
      ]),
    );
  });

  it('reflects and retries a retryable infrastructure error within budget', async () => {
    const checkpoints = new InMemoryAgentCheckpointStore();
    const events = new InMemoryAgentEventSink();
    const kernel = new AgentKernel({
      checkpointStore: checkpoints,
      eventSink: events,
    });
    const invoke = vi
      .fn<AgentKernelTool<{ taskId: string }, { status: string }>['invoke']>()
      .mockRejectedValueOnce(
        new AgentRuntimeError(
          'UNITY_CONNECTION_UNAVAILABLE',
          'Unity bridge is temporarily unavailable',
          true,
        ),
      )
      .mockResolvedValueOnce({ status: 'completed' });

    const result = await kernel.executeAction({
      runId: 'run-1',
      sessionId: 'session-1',
      policy,
      action: action(tool(invoke)),
    });

    expect(result.attempts).toBe(2);
    expect(result.usage.retries).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(
      events.events.some((event) => event.type === 'agent.reflect.retrying'),
    ).toBe(true);
  });

  it('fails closed when an interrupted tool is not idempotent', async () => {
    const checkpoints = new InMemoryAgentCheckpointStore();
    const events = new InMemoryAgentEventSink();
    const kernel = new AgentKernel({
      checkpointStore: checkpoints,
      eventSink: events,
    });
    const invoke = vi.fn(async () => ({ status: 'completed' }));
    const idempotentAction = action(tool(invoke));
    await kernel.executeAction({
      runId: 'run-1',
      sessionId: 'session-1',
      policy,
      action: idempotentAction,
    });
    const checkpoint = await checkpoints.load('run-1');
    if (!checkpoint) throw new Error('checkpoint missing');
    const completedAction = checkpoint.actions[idempotentAction.idempotencyKey];
    if (!completedAction) throw new Error('action checkpoint missing');
    checkpoint.actions[idempotentAction.idempotencyKey] = {
      ...completedAction,
      status: 'running',
    };
    await checkpoints.save(checkpoint);

    await expect(
      kernel.executeAction({
        runId: 'run-1',
        sessionId: 'session-1',
        policy,
        action: action(tool(invoke, false)),
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_REQUIRES_RECONCILIATION' });
  });

  it('rejects tools and safety classes outside the policy', async () => {
    const kernel = new AgentKernel({
      checkpointStore: new InMemoryAgentCheckpointStore(),
      eventSink: new InMemoryAgentEventSink(),
    });
    const foreignTool = {
      ...tool(async () => ({ status: 'completed' })),
      name: 'shell.execute',
      safetyClass: 'arbitrary_code',
    };

    await expect(
      kernel.executeAction({
        runId: 'run-1',
        sessionId: 'session-1',
        policy,
        action: action(foreignTool),
      }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
  });

  it('stops before exceeding the durable tool-call budget', async () => {
    const kernel = new AgentKernel({
      checkpointStore: new InMemoryAgentCheckpointStore(),
      eventSink: new InMemoryAgentEventSink(),
    });
    const constrained = {
      ...policy,
      budget: { ...policy.budget, maxSteps: 1, maxToolCalls: 1 },
    };
    const execute = tool(async () => ({ status: 'completed' }));
    await kernel.executeAction({
      runId: 'run-1',
      sessionId: 'session-1',
      policy: constrained,
      action: action(execute, 'scene'),
    });

    await expect(
      kernel.executeAction({
        runId: 'run-1',
        sessionId: 'session-1',
        policy: constrained,
        action: action(execute, 'player'),
      }),
    ).rejects.toMatchObject({ code: 'AGENT_STEP_BUDGET_EXHAUSTED' });
  });

  it('does not grant extra retries after reloading an exhausted failure', async () => {
    const checkpoints = new InMemoryAgentCheckpointStore();
    const firstKernel = new AgentKernel({
      checkpointStore: checkpoints,
      eventSink: new InMemoryAgentEventSink(),
    });
    const invoke = vi.fn(async () => {
      throw new AgentRuntimeError(
        'UNITY_CONNECTION_UNAVAILABLE',
        'Unity bridge unavailable',
        true,
      );
    });
    await expect(
      firstKernel.executeAction({
        runId: 'run-1',
        sessionId: 'session-1',
        policy,
        action: action(tool(invoke)),
      }),
    ).rejects.toMatchObject({ code: 'UNITY_CONNECTION_UNAVAILABLE' });
    expect(invoke).toHaveBeenCalledTimes(2);

    const recoveredKernel = new AgentKernel({
      checkpointStore: checkpoints,
      eventSink: new InMemoryAgentEventSink(),
    });
    await expect(
      recoveredKernel.executeAction({
        runId: 'run-1',
        sessionId: 'session-1',
        policy,
        action: action(tool(invoke)),
      }),
    ).rejects.toMatchObject({ code: 'UNITY_CONNECTION_UNAVAILABLE' });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
