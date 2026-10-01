import { makeSkill } from '../registry';

export function createObstacleSystemSkill() {
  return makeSkill({
    id: 'create_obstacle_system',
    requiredEngineCapabilities: ['prefab.create', 'component.set_property'],
    artifacts: [
      'Assets/Game/Scripts/Obstacle.cs',
      'Assets/Game/Prefabs/Obstacle.prefab',
    ],
    validationReference: 'RunnerEditModeTests.ObstacleConfiguration',
  });
}
