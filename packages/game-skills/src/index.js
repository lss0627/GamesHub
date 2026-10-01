export * from './registry';
export * from './runner/change-gameplay-parameter';
export * from './runner/create-coin-system';
export * from './runner/create-game-over';
export * from './runner/create-obstacle-system';
export * from './runner/create-platformer-player';
export * from './runner/create-runner-project';
export * from './runner/replace-character-asset';

import { GameSkillRegistry } from './registry';
import { changeGameplayParameterSkill } from './runner/change-gameplay-parameter';
import { createCoinSystemSkill } from './runner/create-coin-system';
import { createGameOverSkill } from './runner/create-game-over';
import { createObstacleSystemSkill } from './runner/create-obstacle-system';
import { createPlatformerPlayerSkill } from './runner/create-platformer-player';
import { createRunnerProjectSkill } from './runner/create-runner-project';
import { replaceCharacterAssetSkill } from './runner/replace-character-asset';
export function createRunnerSkillRegistry() {
  return new GameSkillRegistry()
    .register(createRunnerProjectSkill())
    .register(createPlatformerPlayerSkill())
    .register(createObstacleSystemSkill())
    .register(createCoinSystemSkill())
    .register(createGameOverSkill())
    .register(changeGameplayParameterSkill())
    .register(replaceCharacterAssetSkill());
}
