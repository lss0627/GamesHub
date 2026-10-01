export interface ImpactSet {
  files: string[];
  scenes: string[];
  assertionIds: string[];
  capabilities: string[];
}

const capabilityImpact: Record<string, ImpactSet> = {
  'component.set_property': {
    files: ['Assets/Game/Scripts/PlayerController.cs'],
    scenes: ['runner_scene'],
    assertionIds: ['player_jumps', 'player_lands'],
    capabilities: ['component.set_property'],
  },
  'asset.import': {
    files: ['Assets/Game/Art/Player.png'],
    scenes: ['runner_scene'],
    assertionIds: ['web_preview_loads'],
    capabilities: ['asset.import'],
  },
  'score.read': {
    files: ['Assets/Game/Scripts/Coin.cs'],
    scenes: ['runner_scene'],
    assertionIds: ['coin_scores'],
    capabilities: ['score.read'],
  },
};

export function analyzeImpact(input: {
  changedPaths: string[];
  capabilities?: string[];
}): ImpactSet {
  const capabilities =
    input.capabilities ??
    (input.changedPaths.some((path) => path.includes('jump_height'))
      ? ['component.set_property']
      : []);
  const sets = capabilities
    .map((capability) => capabilityImpact[capability])
    .filter((set): set is ImpactSet => Boolean(set));
  return {
    files: [...new Set(sets.flatMap((set) => set.files))],
    scenes: [...new Set(sets.flatMap((set) => set.scenes))],
    assertionIds: [...new Set(sets.flatMap((set) => set.assertionIds))],
    capabilities: [...new Set(capabilities)],
  };
}
