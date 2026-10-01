import {
  applySemanticPatch,
  runnerGameSpec,
  semanticDiff,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('Game Spec semantic diff', () => {
  it('produces a canonical patch and applies only declared fields', () => {
    const next = structuredClone(runnerGameSpec);
    next.player.movement.jump_height = 5;
    const diff = semanticDiff(runnerGameSpec, next);
    expect(diff.changedPaths).toContain('/player/movement/jump_height');
    expect(
      applySemanticPatch(runnerGameSpec, diff.patch).player.movement
        .jump_height,
    ).toBe(5);
  });
});
