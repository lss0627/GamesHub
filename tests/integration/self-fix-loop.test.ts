import { describe, expect, it } from 'vitest';
import { runSelfFixLoop } from '../../apps/orchestrator-worker/src/workflows/self-fix';

describe('bounded self-fix workflow', () => {
  it('stops after five iterations and selects targeted regressions', async () => {
    const result = await runSelfFixLoop({
      maxIterations: 5,
      issues: [
        {
          id: 'coin',
          assertionId: 'coin_scores',
          affectedCapabilities: ['score.read'],
        },
      ],
      executeFix: async () => false,
    });
    expect(result.iterations).toBe(5);
    expect(result.stopReason).toBe('iteration_limit');
    expect(result.targetedAssertions).toContain('coin_scores');
  });
});
