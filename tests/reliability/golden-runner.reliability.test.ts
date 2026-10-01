import { runGoldenRunnerReliability } from '@gamerhub/playtest';
import { describe, expect, it } from 'vitest';

describe('golden runner reliability', () => {
  it('keeps false outcomes below two percent across 50 repeats', async () => {
    const result = await runGoldenRunnerReliability(50);
    expect(result.runs).toBe(50);
    expect(result.falseOutcomeRate).toBeLessThan(0.02);
  });
});
