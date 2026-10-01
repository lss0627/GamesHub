import { makeSkill } from '../registry';

export function createPlatformerPlayerSkill() {
  return makeSkill({
    id: 'create_platformer_player',
    requiredEngineCapabilities: [
      'game_object.create',
      'component.set_property',
      'script.create',
    ],
    artifacts: [
      'Assets/Game/Scripts/PlayerController.cs',
      'Assets/Game/Prefabs/Player.prefab',
    ],
    validationReference: 'RunnerEditModeTests.PlayerConfiguration',
  });
}
