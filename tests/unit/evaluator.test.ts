import { compileAssertions, evaluateEvidence } from '@gamerhub/evaluator';
import { runnerGameSpec } from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('evaluator', () => {
  it('never invents evidence IDs or passes observations without evidence', () => {
    const assertions = compileAssertions(runnerGameSpec);
    const report = evaluateEvidence({
      runId: '11111111-1111-4111-8111-111111111111',
      playtestRunId: '22222222-2222-4222-8222-222222222222',
      gameSpecVersionId: '33333333-3333-4333-8333-333333333333',
      assertions,
      evidence: assertions.map((item) => ({
        assertionId: item.assertionId,
        status: 'passed',
      })),
    });
    expect(report.status).toBe('inconclusive');
    expect(
      report.assertion_results.every(
        (result) => result.evidence_ids.length === 0,
      ),
    ).toBe(true);
  });
  it('compiles every spec verification into an executable assertion', () => {
    const assertions = compileAssertions(runnerGameSpec);
    expect(assertions).toHaveLength(runnerGameSpec.verification.length);
    expect(assertions[0]?.assertionId).toBe('player_moves');
  });

  it('reports evidence-only results and issues', () => {
    const report = evaluateEvidence({
      runId: '11111111-1111-4111-8111-111111111111',
      playtestRunId: '22222222-2222-4222-8222-222222222222',
      gameSpecVersionId: '33333333-3333-4333-8333-333333333333',
      assertions: compileAssertions(runnerGameSpec),
      evidence: [
        {
          assertionId: 'coin_scores',
          status: 'failed',
          summary: 'score did not change',
          actual: { score: 0 },
        },
      ],
    });
    expect(report.status).toBe('failed');
    expect(report.issues[0]?.affected_capabilities).toContain('score.read');
  });
});
