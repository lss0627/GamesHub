import { InMemoryLicensedScheduler } from '@gamerhub/sandbox';
import { describe, expect, it } from 'vitest';

describe('editor and license leases', () => {
  it('never overcommits a license entitlement under concurrent reservations', async () => {
    const scheduler = new InMemoryLicensedScheduler({
      workerCount: 2,
      licenseCount: 1,
      concurrencyLimit: 1,
    });
    const results = await Promise.all([
      scheduler.reserve({
        runId: 'run-1',
        projectId: 'project-1',
        editorVersion: '6000.0.80f1',
        capabilities: ['web_build'],
        idempotencyKey: 'one',
      }),
      scheduler.reserve({
        runId: 'run-2',
        projectId: 'project-2',
        editorVersion: '6000.0.80f1',
        capabilities: ['web_build'],
        idempotencyKey: 'two',
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'reserved'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'waiting_for_license'),
    ).toHaveLength(1);
  });

  it('quarantines a worker when return cannot confirm editor cleanup', async () => {
    const scheduler = new InMemoryLicensedScheduler({
      workerCount: 1,
      licenseCount: 1,
      concurrencyLimit: 1,
    });
    const reservation = await scheduler.reserve({
      runId: 'run-1',
      projectId: 'project-1',
      editorVersion: '6000.0.80f1',
      capabilities: ['playmode'],
      idempotencyKey: 'one',
    });
    const handle = await scheduler.activate(reservation.reservationId);
    const release = await scheduler.release(handle.handleId, {
      editorStopped: false,
    });
    expect(release.status).toBe('quarantined');
    expect(release.licenseReturned).toBe(false);
  });
});
