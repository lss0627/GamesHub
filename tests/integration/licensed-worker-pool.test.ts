import { LicensedScheduler } from '@gamerhub/sandbox';
import { describe, expect, it } from 'vitest';

const request = (id: string) => ({
  runId: id,
  projectId: `project-${id}`,
  editorVersion: '6000.0.80f1',
  capabilities: ['web_build'],
  idempotencyKey: `key-${id}`,
});

describe('licensed worker pool', () => {
  it('never overcommits, returns leases, and quarantines failed cleanup', async () => {
    const scheduler = new LicensedScheduler({
      workers: [{ id: 'worker-1', status: 'ready' }],
      licenses: [{ id: 'license-1', concurrencyLimit: 1, status: 'active' }],
    });
    const first = await scheduler.reserve(request('run-1'));
    const second = await scheduler.reserve(request('run-2'));
    expect(first.status).toBe('reserved');
    expect(second.status).toBe('waiting_for_license');
    const handle = await scheduler.activate(first.reservationId);
    expect(
      (await scheduler.release(handle.handleId, { editorStopped: false }))
        .status,
    ).toBe('quarantined');
    expect((await scheduler.health()).quarantinedWorkers).toBe(1);
  });

  it('assigns unique workers, respects per-license concurrency, and promotes waiters', async () => {
    const scheduler = new LicensedScheduler({
      workers: [
        { id: 'worker-1', status: 'ready' },
        { id: 'worker-2', status: 'ready' },
      ],
      licenses: [
        { id: 'license-1', concurrencyLimit: 1, status: 'active' },
        { id: 'license-2', concurrencyLimit: 1, status: 'active' },
      ],
    });
    const first = await scheduler.reserve(request('run-1'));
    const second = await scheduler.reserve(request('run-2'));
    const third = await scheduler.reserve(request('run-3'));
    expect(first.status).toBe('reserved');
    expect(second.status).toBe('reserved');
    expect(new Set([first.workerId, second.workerId]).size).toBe(2);
    expect(third.status).toBe('waiting_for_license');

    const handle = await scheduler.activate(first.reservationId);
    await scheduler.release(handle.handleId);
    const promoted = await scheduler.reserve(request('run-3'));
    expect(promoted.status).toBe('reserved');
    expect(promoted.workerId).toBe(first.workerId);
  });

  it('does not allocate expired licenses', async () => {
    const scheduler = new LicensedScheduler({
      workers: [{ id: 'worker-1', status: 'ready' }],
      licenses: [
        {
          id: 'license-expired',
          concurrencyLimit: 1,
          status: 'active',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    expect((await scheduler.reserve(request('run-expired'))).status).toBe(
      'waiting_for_license',
    );
  });
});
