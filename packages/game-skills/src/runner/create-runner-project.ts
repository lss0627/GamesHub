import { makeSkill } from '../registry';

export function createRunnerProjectSkill() {
  return makeSkill({
    id: 'create_runner_project',
    requiredEngineCapabilities: ['scene.create'],
    artifacts: [
      'Assets/Game/Scenes/Runner.unity',
      'Assets/Game/Prefabs/Player.prefab',
    ],
    validationReference: 'RunnerEditModeTests.SceneBaseline',
  });
}
