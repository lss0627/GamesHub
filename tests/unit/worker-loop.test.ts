import { describe, expect, it, vi } from 'vitest';
import { runWorkerLoop } from '../../apps/orchestrator-worker/src/worker';

describe('runWorkerLoop', () => {
  it('continues PostgreSQL polling if the optional wakeup transport fails', async () => {
    const controller = new AbortController();
    const expected = new Error('redis offline');
    const onError = vi.fn(() => controller.abort());
    await runWorkerLoop(
      { processNext: async () => undefined },
      {
        signal: controller.signal,
        waitForWork: async () => {
          throw expected;
        },
        onError,
      },
    );
    expect(onError).toHaveBeenCalledWith(expected);
  });
  it('isolates one worker iteration failure instead of terminating the service', async () => {
    const controller = new AbortController();
    const expected = new Error('transient database deadlock');
    const onError = vi.fn(() => controller.abort());
    const processNext = vi.fn(async () => {
      throw expected;
    });

    await expect(
      runWorkerLoop(
        { processNext },
        {
          signal: controller.signal,
          pollIntervalMs: 100,
          onError,
        },
      ),
    ).resolves.toBeUndefined();

    expect(processNext).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expected);
  });
});
