import type { GameSpec } from './types';

export interface MechanismField {
  kind: 'number' | 'constant';
  min?: number;
  max?: number;
  integer?: boolean;
  value?: unknown;
  alternatives?: unknown[];
  target?: string;
}
export interface MechanismDefinition {
  id: string;
  version: 1;
  fields: Record<string, MechanismField>;
  input: string[];
  assertions: string[];
}
const number = (
  min: number,
  max: number,
  target: string,
  integer = false,
): MechanismField => ({ kind: 'number', min, max, target, integer });
const fixed = (value: unknown): MechanismField => ({ kind: 'constant', value });

/** The same descriptors validate approved values and map them into engine config. */
export function mechanismsFor(spec: GameSpec): MechanismDefinition[] {
  const clicker = spec.game.genre === 'clicker';
  const arena = ['survivor', 'top_down_shooter'].includes(spec.game.genre);
  const fields: Record<string, Record<string, MechanismField>> = {
    coin_collection: { score_per_coin: number(1, 100, 'scorePerCoin', true) },
    obstacle: { collision_damage: fixed(1) },
    spawn: {
      seed: number(0, 2147483647, 'seed', true),
      interval_seconds: number(0.1, 3600, 'spawnIntervalSeconds'),
    },
    game_over: { restart: fixed(true) },
    combat: {
      damage: number(1, 20, 'damage', true),
      interval_seconds: number(0.15, 3, 'attackInterval'),
      range:
        spec.game.genre === 'tower_defense'
          ? fixed(3.6)
          : number(1, 8, 'attackRange'),
      auto_attack: fixed(
        spec.game.genre === 'survivor' || spec.game.genre === 'tower_defense',
      ),
      enemy_hp: number(1, 20, 'enemyHp', true),
      enemy_speed: number(0.2, 4, 'enemySpeed'),
    },
    xp: { per_level: number(1, 20, 'xpPerLevel', true) },
    level_up: {
      choices: {
        ...fixed(['damage', 'speed', 'heal', 'multishot']),
        alternatives: [['damage', 'speed', 'heal']],
      },
      upgrade_cost: clicker ? number(5, 500, 'upgradeCost', true) : fixed(30),
    },
    wave: {
      count: fixed(5),
      initial_currency: fixed(100),
      build_cost: fixed(30),
    },
    checkpoint:
      spec.game.genre === 'puzzle'
        ? { undo: fixed(true), layout: fixed('sokoban-1') }
        : { positions: fixed([13, 26]), exit_x: fixed(43) },
    dialogue: {
      story: fixed('star-lantern-1'),
      inventory: fixed(['star_key']),
    },
    score: clicker
      ? {
          per_click: number(1, 100, 'scorePerCoin', true),
          goal: number(50, 10000, 'goal', true),
          auto_income: number(0, 50, 'autoIncome', true),
        }
      : arena
        ? {
            per_click: fixed(10),
            goal: fixed(300),
            auto_income: fixed(0),
            initial_score: fixed(0),
          }
        : { initial_score: fixed(0) },
  };
  return spec.systems
    .filter((s) => s.enabled)
    .map((system) => ({
      id: system.type,
      version: 1,
      fields: fields[system.type] ?? {},
      input:
        system.type === 'combat'
          ? [spec.game.genre === 'survivor' ? 'automatic' : 'aim', 'attack']
          : system.type === 'level_up'
            ? ['choose_upgrade']
            : [],
      assertions: [
        `${system.type}.configuration`,
        `${system.type}.state_transition`,
      ],
    }));
}

export function assessMechanisms(spec: GameSpec) {
  const gaps: string[] = [];
  const config: Record<string, number> = {};
  const definitions = mechanismsFor(spec);
  for (const system of spec.systems.filter((s) => s.enabled)) {
    const definition = definitions.find((d) => d.id === system.type);
    for (const [key, value] of Object.entries(system.config)) {
      const field = definition?.fields[key];
      if (!field) {
        gaps.push(`未接入玩法参数：${system.type}.${key}`);
        continue;
      }
      const valid =
        field.kind === 'constant'
          ? [field.value, ...(field.alternatives ?? [])].some(
              (candidate) =>
                JSON.stringify(value) === JSON.stringify(candidate),
            )
          : typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= (field.min ?? -Infinity) &&
            value <= (field.max ?? Infinity) &&
            (!field.integer || Number.isInteger(value));
      if (!valid)
        gaps.push(`玩法参数不受支持或超出范围：${system.type}.${key}`);
      else if (field.target && typeof value === 'number')
        config[field.target] = value;
      else if (
        valid &&
        system.type === 'level_up' &&
        key === 'choices' &&
        Array.isArray(value)
      )
        config.upgradeChoicesCount = value.length;
    }
  }
  return { gaps, config, definitions };
}

export function assessRules(spec: GameSpec): string[] {
  const gaps: string[] = [];
  const clicker = spec.game.genre === 'clicker';
  const runner = spec.game.genre === 'runner';
  if (spec.game.genre === 'custom') return gaps;
  if (spec.game.genre === 'flappy') {
    const interval =
      spec.systems.find((system) => system.enabled && system.type === 'spawn')
        ?.config.interval_seconds ?? 2;
    if (
      typeof interval === 'number' &&
      spec.level.duration_seconds <
        0.8 + 19 / spec.player.movement.speed + 7 * interval
    )
      gaps.push(
        '当前速度、生成间隔和时限不足以遇到8道门，请延长时限或调整节奏',
      );
  }
  if (spec.game.genre === 'platformer') {
    const jump = spec.player.movement.jump_height;
    // The fixed course has 3-unit pits; landing is possible down to y=0.2.
    const range =
      (spec.player.movement.speed *
        (jump + Math.sqrt(jump * jump + 2 * 18 * 0.8))) /
      18;
    if (jump < 6 || range < 3.05)
      gaps.push(
        '当前移动与跳跃组合不足以稳定越过最宽深坑，请提高速度或跳跃力度',
      );
  }
  const goal =
    spec.systems.find((s) => s.enabled && s.type === 'score')?.config.goal ??
    300;
  const preset = presetRules(spec.game.genre, spec.level.duration_seconds);
  const expectedWin =
    preset?.win ??
    (clicker
      ? { score_at_least: { score: goal } }
      : { survive_seconds: { seconds: spec.level.duration_seconds } });
  const expectedLose =
    preset?.lose ??
    (clicker
      ? { time_expired: { seconds: spec.level.duration_seconds } }
      : runner
        ? { collision: { with: 'obstacle' }, fall_out: { min_y: -5 } }
        : { player_hp_zero: {} });
  for (const [label, conditions, expected] of [
    ['胜利', spec.rules.win_conditions, expectedWin],
    ['失败', spec.rules.lose_conditions, expectedLose],
  ] as const) {
    if (conditions.length !== Object.keys(expected).length)
      gaps.push(`${label}条件数量与玩法不符`);
    const seen = new Set<string>();
    for (const condition of conditions) {
      const parameters = (expected as Record<string, unknown>)[condition.type];
      const actual = Object.entries(condition.parameters).sort();
      const wanted = parameters ? Object.entries(parameters).sort() : undefined;
      if (
        seen.has(condition.type) ||
        !wanted ||
        JSON.stringify(actual) !== JSON.stringify(wanted)
      )
        gaps.push(`未接入或相互矛盾的${label}条件：${condition.type}`);
      seen.add(condition.type);
    }
  }
  return gaps;
}

export function supportedBriefMechanics(
  genre: GameSpec['game']['genre'],
): string[] {
  if (['survivor', 'top_down_shooter'].includes(genre))
    return [
      'maxHp',
      'enemySpeed',
      'enemyHp',
      'damage',
      'attackInterval',
      'attackRange',
      'xpPerLevel',
    ];
  if (genre === 'clicker') return ['upgradeCost', 'goal', 'autoIncome'];
  if (genre === 'tower_defense')
    return ['maxHp', 'enemyHp', 'enemySpeed', 'damage', 'attackInterval'];
  if (genre === 'platformer' || genre === 'breakout') return ['maxHp'];
  return [];
}

export function presetRules(
  genre: GameSpec['game']['genre'],
  duration: number,
):
  | {
      win: Record<string, Record<string, unknown>>;
      lose: Record<string, Record<string, unknown>>;
    }
  | undefined {
  const timeout = { time_expired: { seconds: duration } };
  switch (genre) {
    case 'flappy':
      return {
        win: { score_at_least: { score: 8 } },
        lose: { collision: { with: 'gate_or_boundary' }, ...timeout },
      };
    case 'breakout':
      return {
        win: { collect_count: { entity: 'brick', count: 24 } },
        lose: { player_hp_zero: {}, ...timeout },
      };
    case 'platformer':
      return {
        win: { reach_goal: { x: 43 } },
        lose: { player_hp_zero: {}, ...timeout },
      };
    case 'tower_defense':
      return {
        win: { reach_goal: { waves: 5 } },
        lose: { player_hp_zero: {}, ...timeout },
      };
    case 'puzzle':
      return { win: { reach_goal: { boxes_on_goals: 3 } }, lose: timeout };
    case 'rpg_dialogue':
      return {
        win: { reach_goal: { ending: 'star_lantern' } },
        lose: { reach_goal: { ending: 'storm' }, ...timeout },
      };
    default:
      return undefined;
  }
}
