import { analyzeImpact } from '@gamerhub/game-planner';
import { describe, expect, it } from 'vitest';

describe('impact analyzer', () => {
  it('maps capability changes to files, scenes and targeted assertions', () => {
    const impact = analyzeImpact({
      changedPaths: ['/player/movement/jump_height'],
      capabilities: ['component.set_property'],
    });
    expect(impact.files).toContain('Assets/Game/Scripts/PlayerController.cs');
    expect(impact.scenes).toContain('runner_scene');
    expect(impact.assertionIds).toContain('player_jumps');
  });
});
