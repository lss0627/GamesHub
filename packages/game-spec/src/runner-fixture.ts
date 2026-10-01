import type { GameSpec } from './types';

export const runnerGameSpec: GameSpec = {
  schema_version: '1.0.0',
  game: {
    name: 'Cat Coin Runner',
    genre: 'runner',
    target_platform: 'web',
    template: 'runner-v1',
    description: '一只猫咪自动向前奔跑，跳跃躲避障碍并收集金币。',
  },
  player: {
    entity_id: 'player',
    appearance: { logical_asset_id: 'cat_player' },
    movement: {
      type: 'side_scroll',
      speed: 6,
      jump_height: 3.5,
      air_control: 0.4,
    },
    health: { max_hp: 1 },
  },
  systems: [
    {
      system_id: 'coin_collection',
      type: 'coin_collection',
      enabled: true,
      config: { score_per_coin: 10 },
    },
    {
      system_id: 'score',
      type: 'score',
      enabled: true,
      config: { initial_score: 0 },
    },
    {
      system_id: 'obstacle',
      type: 'obstacle',
      enabled: true,
      config: { collision_damage: 1 },
    },
    {
      system_id: 'spawn',
      type: 'spawn',
      enabled: true,
      config: { seed: 42, interval_seconds: 2 },
    },
    {
      system_id: 'game_over',
      type: 'game_over',
      enabled: true,
      config: { restart: true },
    },
  ],
  level: {
    scene_id: 'runner_scene',
    duration_seconds: 60,
    entities: [
      {
        entity_id: 'player',
        type: 'player',
        count: 1,
        properties: { start_x: 0, start_y: 1 },
      },
      {
        entity_id: 'ground',
        type: 'ground',
        count: 1,
        properties: { width: 200 },
      },
      {
        entity_id: 'obstacle_row',
        type: 'obstacle',
        count: 8,
        properties: { spacing: 12 },
      },
      {
        entity_id: 'coin_row',
        type: 'coin',
        count: 16,
        properties: { spacing: 4 },
      },
    ],
  },
  rules: {
    win_conditions: [
      {
        condition_id: 'survive_one_minute',
        type: 'survive_seconds',
        parameters: { seconds: 60 },
      },
    ],
    lose_conditions: [
      {
        condition_id: 'player_collision',
        type: 'collision',
        parameters: { with: 'obstacle' },
      },
      {
        condition_id: 'player_fall',
        type: 'fall_out',
        parameters: { min_y: -5 },
      },
    ],
  },
  ui: { hud: ['score', 'coins', 'timer'], game_over: true, restart: true },
  assets: [
    { logical_id: 'cat_player', type: 'sprite', source: 'placeholder' },
    { logical_id: 'coin', type: 'sprite', source: 'builtin' },
    { logical_id: 'obstacle', type: 'sprite', source: 'builtin' },
  ],
  verification: [
    {
      assertion_id: 'player_moves',
      capability: 'play.input',
      severity: 'critical',
      preconditions: [],
      actions: [{ type: 'move', direction: 'right', duration_ms: 1000 }],
      expected: [{ type: 'position_x_increases' }],
    },
    {
      assertion_id: 'player_jumps',
      capability: 'play.input',
      severity: 'high',
      preconditions: [],
      actions: [{ type: 'jump' }],
      expected: [{ type: 'vertical_velocity_positive' }],
    },
    {
      assertion_id: 'player_lands',
      capability: 'play.state',
      severity: 'high',
      preconditions: [{ type: 'airborne' }],
      actions: [{ type: 'wait', duration_ms: 1000 }],
      expected: [{ type: 'grounded' }],
    },
    {
      assertion_id: 'obstacle_blocks',
      capability: 'collision.observe',
      severity: 'critical',
      preconditions: [{ type: 'near', entity: 'obstacle' }],
      actions: [{ type: 'move', direction: 'right', duration_ms: 500 }],
      expected: [{ type: 'collision', with: 'obstacle' }],
    },
    {
      assertion_id: 'coin_scores',
      capability: 'score.read',
      severity: 'high',
      preconditions: [{ type: 'near', entity: 'coin' }],
      actions: [{ type: 'move', direction: 'right', duration_ms: 500 }],
      expected: [{ type: 'score_increases' }],
    },
    {
      assertion_id: 'collision_game_over',
      capability: 'game.state',
      severity: 'critical',
      preconditions: [],
      actions: [{ type: 'hit', target: 'obstacle' }],
      expected: [{ type: 'game_over' }],
    },
    {
      assertion_id: 'restart_resets',
      capability: 'game.restart',
      severity: 'high',
      preconditions: [{ type: 'game_over' }],
      actions: [{ type: 'restart' }],
      expected: [{ type: 'score_equals', value: 0 }, { type: 'game_running' }],
    },
    {
      assertion_id: 'web_preview_loads',
      capability: 'web.smoke',
      severity: 'critical',
      preconditions: [],
      actions: [{ type: 'load_web_build' }],
      expected: [{ type: 'canvas_visible' }, { type: 'input_enabled' }],
    },
  ],
};
