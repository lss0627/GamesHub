import { measureRunnerPhases } from '@gamerhub/unity-adapter';
import { describe, expect, it } from 'vitest';

describe('Unity Runner performance fixture', () => {
  it('records cold and warm phase timings with tuning notes', async () => {
    const result = await measureRunnerPhases();
    expect(result.cold.importMs).toBeGreaterThanOrEqual(0);
    expect(result.warm.compileMs).toBeGreaterThanOrEqual(0);
    expect(result.tuning.length).toBeGreaterThan(0);
  });
});
