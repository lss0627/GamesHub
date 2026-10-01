import { makeSkill } from '../registry';

export function createGameOverSkill() {
  return makeSkill({
    id: 'create_game_over',
    requiredEngineCapabilities: ['script.create', 'ui.create'],
    artifacts: [
      'Assets/Game/Scripts/RunnerGameManager.cs',
      'Assets/Game/Scripts/RunnerHud.cs',
    ],
    validationReference: 'RunnerPlayModeTests.RestartAfterGameOver',
  });
}
