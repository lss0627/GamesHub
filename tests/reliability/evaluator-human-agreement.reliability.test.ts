import { evaluateHumanAgreement } from '@gamerhub/evaluator';
import { describe, expect, it } from 'vitest';

describe('human reference agreement', () => {
  it('reports denominators and agreement for all frozen cases', async () => {
    const result = await evaluateHumanAgreement();
    expect(result.cases).toBeGreaterThanOrEqual(60);
    expect(result.reviewedByTwo).toBe(result.cases);
    expect(result.arbitrated).toBe(result.cases);
    expect(result.agreement).toBeGreaterThanOrEqual(0.9);
  });

  it('fails closed when release mode lacks an external evaluator and provenance', async () => {
    await expect(
      evaluateHumanAgreement({ requireExternalEvidence: true }),
    ).rejects.toThrow('EVALUATION_EXTERNAL_PROVENANCE_REQUIRED');
  });
});
