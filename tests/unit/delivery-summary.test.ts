import { expect, it } from 'vitest';
import { deliverySummary } from '../../apps/studio-web/src/features/runs/DeliveryEvidence';

const prepared = {
  sequence: 1,
  type: 'run.delivery.prepared',
  payload: {
    runId: 'run',
    specVersionId: 'spec',
    buildHash: 'sha256-build',
    tests: [],
    browser: {
      passed: true,
      checks: [],
      reportHash: `sha256-${'b'.repeat(64)}`,
    },
  },
};
const committed = {
  sequence: 2,
  type: 'run.succeeded',
  payload: { specVersionId: 'spec', buildContentHash: 'sha256-build' },
};
it('requires matching committed success before presenting verified delivery', () => {
  expect(deliverySummary('run', 'executing', [prepared]).status).toBe(
    'pending',
  );
  expect(deliverySummary('run', 'failed', [prepared]).status).toBe('failed');
  expect(
    deliverySummary('run', 'succeeded', [prepared, committed]).status,
  ).toBe('verified');
  expect(
    deliverySummary('other', 'succeeded', [prepared, committed]).status,
  ).toBe('unverified');
  expect(
    deliverySummary('run', 'succeeded', [
      prepared,
      { ...committed, payload: { specVersionId: 'other' } },
    ]).status,
  ).toBe('unverified');
});
it('keeps old runs explicitly unverified and exposes recovery separately', () => {
  expect(deliverySummary('run', 'succeeded', [committed]).status).toBe(
    'unverified',
  );
  expect(
    deliverySummary('run', 'failed', [
      {
        sequence: 1,
        type: 'run.source.recovered',
        payload: { archived: true },
      },
    ]).recovery,
  ).toBe('recovered');
  expect(
    deliverySummary('run', 'failed', [
      { sequence: 1, type: 'run.source.recovery_failed', payload: {} },
    ]).recovery,
  ).toBe('failed');
});
