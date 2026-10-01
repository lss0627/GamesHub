export * from './registry';
export * from './runner/change-gameplay-parameter';
export * from './runner/create-coin-system';
export * from './runner/create-game-over';
export * from './runner/create-obstacle-system';
export * from './runner/create-platformer-player';
export * from './runner/create-runner-project';
export * from './runner/replace-character-asset';

import { GameSkillRegistry } from './registry';
export declare function createRunnerSkillRegistry(): GameSkillRegistry;
