import type { PlatformStore } from '@gamerhub/domain';
import { expect, it, vi } from 'vitest';
import {
  acceptPythonResponse,
  PythonPiActionRuntime,
  PythonPiModelProvider,
  pythonCallback,
} from '../../apps/local-dev/src/python-agent';

it('cancels the owned Pi request when the design deadline aborts', async () => {
  const frames: Array<{ type: string; id: string }> = [];
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk) => {
      frames.push(JSON.parse(String(chunk)));
      return true;
    });
  try {
    const controller = new AbortController();
    const stream = new PythonPiModelProvider().generate({
      runId: 'design-abort',
      role: 'planner',
      messages: [],
      timeoutMs: 120000,
      tokenBudget: 100,
      signal: controller.signal,
    });
    const result = stream.next();
    const rejected = expect(result).rejects.toMatchObject({
      code: 'PI_CANCELLED',
    });
    controller.abort();
    await rejected;
    expect(frames.map((frame) => frame.type)).toEqual([
      'python_request',
      'python_cancel',
    ]);
    expect(frames[1]?.id).toBe(frames[0]?.id);
    expect(
      acceptPythonResponse({
        type: 'python_response',
        id: frames[0]?.id,
        result: {},
      }),
    ).toBe(true);
  } finally {
    output.mockRestore();
  }
});

it('settles a running domain mutation when the Pi host fails', async () => {
  let frameId = '';
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk) => {
      const frame = JSON.parse(String(chunk));
      if (frame.type === 'python_request') frameId = frame.id;
      return true;
    });
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  let settled = false;
  const store = {
    getRunForWorker: async () => ({
      id: 'run',
      projectId: 'project',
      sessionId: 'session',
    }),
    getProject: async () => ({}),
    getRun: async () => ({ status: 'executing' }),
    appendEvent: async () => ({}),
  } as unknown as PlatformStore;
  try {
    const pending = new PythonPiActionRuntime(store, 'owner')
      .executeAction({
        runId: 'run',
        sessionId: 'session',
        policy: {
          allowedToolNames: ['unity.task.execute'],
          allowedSafetyClasses: ['engine_mutation'],
          budget: {
            maxSteps: 4,
            maxToolCalls: 4,
            maxRetriesPerAction: 1,
            deadlineMs: 60000,
          },
        },
        action: {
          id: 'test',
          idempotencyKey: 'test',
          input: {},
          tool: {
            name: 'unity.task.execute',
            version: '1',
            safetyClass: 'engine_mutation',
            idempotent: false,
            invoke: async (_input, context) => {
              signal = context.signal;
              await new Promise<void>((resolve) => {
                release = resolve;
              });
              return { status: 'completed' };
            },
          },
        },
      })
      .then(
        () => {
          settled = true;
          return 'unexpected';
        },
        (error) => {
          settled = true;
          return error.code;
        },
      );
    await vi.waitFor(() => expect(frameId).not.toBe(''));
    const invocation = pythonCallback(frameId, 'invoke', { attempt: 1 });
    await vi.waitFor(() => expect(release).toBeDefined());
    acceptPythonResponse({
      type: 'python_response',
      id: frameId,
      error: 'PI_PROCESS_EXITED',
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(settled).toBe(false);
    release?.();
    await invocation;
    expect(await pending).toBe('PI_PROCESS_EXITED');
  } finally {
    release?.();
    output.mockRestore();
  }
});
