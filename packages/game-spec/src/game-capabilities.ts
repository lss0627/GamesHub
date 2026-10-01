import { specCreative } from './creative';
import { developmentFor } from './development';
import { assessMechanisms, assessRules } from './mechanism-registry';
import type { GameSpec } from './types';

export type GameGenre = GameSpec['game']['genre'];
export interface GameCapability {
  genre: GameGenre;
  name: string;
  runtime?: string;
  movement: 'side_scroll' | 'top_down' | 'fixed';
  systems: string[];
  instructions: string;
  loop: string;
  testFilter?: string;
  minimumPlaymodeTests: number;
}
export const gameCapabilities: GameCapability[] = [
  {
    genre: 'runner',
    name: '横版跑酷',
    runtime: 'runner-v1',
    movement: 'side_scroll',
    systems: ['coin_collection', 'obstacle', 'score', 'spawn', 'game_over'],
    instructions:
      '方向键/A、D移动，空格或跳跃按钮起跳；躲开木桩，收集金币，坚持到倒计时结束。',
    loop: '移动跳跃 → 躲避障碍 → 收集得分',
    testFilter: 'RunnerPlayModeTests',
    minimumPlaymodeTests: 4,
  },
  {
    genre: 'survivor',
    name: '幸存者',
    runtime: 'arena-v1',
    movement: 'top_down',
    systems: ['combat', 'xp', 'level_up', 'score', 'spawn', 'game_over'],
    instructions:
      'WASD/方向键或屏幕方向按钮自由移动；自动攻击靠近的敌人，拾取经验，升级时选择强化，活到倒计时结束。',
    loop: '走位生存 → 自动攻击 → 收集经验 → 选择升级',
    testFilter: 'ArenaPlayModeTests',
    minimumPlaymodeTests: 13,
  },
  {
    genre: 'top_down_shooter',
    name: '俯视射击',
    runtime: 'arena-v1',
    movement: 'top_down',
    systems: ['combat', 'xp', 'level_up', 'score', 'spawn', 'game_over'],
    instructions:
      'WASD/方向按钮移动，鼠标指向或触摸战场瞄准，按住空格或点击战场射击；收集经验并选择强化。',
    loop: '走位瞄准 → 弹道射击 → 经验升级 → 生存',
    testFilter: 'ArenaPlayModeTests',
    minimumPlaymodeTests: 13,
  },
  {
    genre: 'clicker',
    name: '点击成长',
    runtime: 'clicker-v1',
    movement: 'fixed',
    systems: ['score', 'level_up', 'game_over'],
    instructions:
      '点击收集按钮获得能量，购买强化提高每次收益与自动收益，在时限内达到目标。',
    loop: '点击收集 → 购买强化 → 提高收益 → 达成目标',
    testFilter: 'ClickerPlayModeTests',
    minimumPlaymodeTests: 7,
  },
  {
    genre: 'flappy',
    name: '飞行躲避',
    runtime: 'flappy-v1',
    movement: 'side_scroll',
    systems: ['obstacle', 'score', 'spawn', 'game_over'],
    instructions: '空格或飞跃按钮起飞，穿过8道门；碰撞或飞出边界失败。',
    loop: '控制高度 → 穿越关卡 → 累计8分通关',
    testFilter: 'FlappyPlayModeTests',
    minimumPlaymodeTests: 3,
  },
  {
    genre: 'breakout',
    name: '打砖块',
    runtime: 'breakout-v1',
    movement: 'side_scroll',
    systems: ['obstacle', 'score', 'game_over'],
    instructions:
      '左右移动挡板，空格或发球按钮发球，击碎24块砖；漏球消耗生命。',
    loop: '发球 → 挡板反弹 → 击碎全部砖块',
    testFilter: 'BreakoutPlayModeTests',
    minimumPlaymodeTests: 2,
  },
  {
    genre: 'platformer',
    name: '平台跳跃',
    runtime: 'platformer-v1',
    movement: 'side_scroll',
    systems: [
      'coin_collection',
      'obstacle',
      'checkpoint',
      'score',
      'game_over',
    ],
    instructions:
      '左右移动、空格或按钮跳跃；越过深坑，经过旗帜保存检查点，到达终点。',
    loop: '探索移动 → 跳过深坑 → 检查点 → 到达终点',
    testFilter: 'PlatformerPlayModeTests',
    minimumPlaymodeTests: 2,
  },
  {
    genre: 'tower_defense',
    name: '塔防',
    runtime: 'tower-defense-v1',
    movement: 'fixed',
    systems: ['combat', 'wave', 'spawn', 'score', 'game_over'],
    instructions:
      '点击空位花30金币建塔，再次点击升级；击败敌人获得金币，守住基地完成5波。',
    loop: '建塔升级 → 自动防守 → 击杀获益 → 完成5波',
    testFilter: 'TowerDefensePlayModeTests',
    minimumPlaymodeTests: 3,
  },
  {
    genre: 'puzzle',
    name: '推箱子解谜',
    runtime: 'sokoban-v1',
    movement: 'top_down',
    systems: ['checkpoint', 'score', 'game_over'],
    instructions:
      '方向键或按钮推箱子，把3个箱子全部放上目标；Z或撤销按钮回退一步。',
    loop: '观察布局 → 推箱子 → 撤销尝试 → 全部归位',
    testFilter: 'PuzzlePlayModeTests',
    minimumPlaymodeTests: 3,
  },
  {
    genre: 'rpg_dialogue',
    name: '分支对话冒险',
    runtime: 'dialogue-v1',
    movement: 'fixed',
    systems: ['dialogue', 'score', 'game_over'],
    instructions:
      '点击对话选项，帮助狐狸获得钥匙，打开旧塔；危险选项会进入失败结局。',
    loop: '选择行动 → 获取钥匙 → 分支结局',
    testFilter: 'DialoguePlayModeTests',
    minimumPlaymodeTests: 2,
  },
  ...([['custom', '其他创意']] as const).map(([genre, name]) => ({
    genre,
    name,
    movement: 'fixed' as const,
    systems: [],
    instructions: '先一起明确操作、目标和核心玩法，再列出所需制作能力。',
    loop: '讨论核心玩法与游戏目标',
    minimumPlaymodeTests: 0,
  })),
];

export const mechanicRanges = {
  maxHp: [1, 20, 5],
  enemySpeed: [0.2, 4, 1],
  enemyHp: [1, 20, 2],
  damage: [1, 20, 1],
  attackInterval: [0.15, 3, 0.7],
  attackRange: [1, 8, 5],
  xpPerLevel: [1, 20, 3],
  upgradeCost: [5, 500, 30],
  goal: [50, 10000, 300],
  autoIncome: [0, 50, 0],
} as const;
export type MechanicKey = keyof typeof mechanicRanges;
export type GameMechanics = Partial<Record<MechanicKey, number>>;
export function validateMechanics(value: unknown): GameMechanics {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('DESIGN_INVALID');
  const result: GameMechanics = {};
  for (const [key, number] of Object.entries(value)) {
    const range = mechanicRanges[key as MechanicKey];
    if (
      !range ||
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < range[0] ||
      number > range[1]
    )
      throw new Error('DESIGN_INVALID');
    if (
      [
        'maxHp',
        'enemyHp',
        'damage',
        'xpPerLevel',
        'upgradeCost',
        'goal',
        'autoIncome',
      ].includes(key) &&
      !Number.isInteger(number)
    )
      throw new Error('DESIGN_INVALID');
    result[key as MechanicKey] = number;
  }
  return result;
}
export function capabilityFor(genre: GameGenre = 'runner'): GameCapability {
  const profile = gameCapabilities.find((item) => item.genre === genre);
  if (!profile) throw new Error('DESIGN_INVALID');
  return profile;
}
export function assessGameCapabilities(spec: GameSpec) {
  const profile = capabilityFor(spec.game.genre);
  const gaps: string[] = [];
  let development = [] as ReturnType<typeof developmentFor>;
  try {
    development = developmentFor(spec);
  } catch {
    gaps.push('机制开发需求缺少有效标识或行为验收');
  }
  const enabledTypes = new Set<string>();
  for (const system of spec.systems.filter((item) => item.enabled)) {
    if (enabledTypes.has(system.type))
      gaps.push(`当前运行时不支持重复的玩法系统：${system.type}`);
    enabledTypes.add(system.type);
  }
  if (!profile.runtime)
    gaps.push(
      `「${profile.name}」尚未接入可执行玩法模块；可以继续完善设计，方案会保存。`,
    );
  else {
    if (spec.game.template !== profile.runtime)
      gaps.push('制作说明与运行时模块不匹配');
    if (spec.player.movement.type !== profile.movement)
      gaps.push('移动方式尚未接入此玩法');
    for (const system of spec.systems.filter((item) => item.enabled))
      if (!profile.systems.includes(system.type))
        gaps.push(`未接入玩法系统：${system.type}`);
    for (const required of profile.systems)
      if (!spec.systems.some((item) => item.type === required && item.enabled))
        gaps.push(`缺少必要玩法系统：${required}`);
    if (profile.runtime === 'arena-v1') {
      const combat =
        spec.systems.find((item) => item.enabled && item.type === 'combat')
          ?.config ?? {};
      const fields: Record<string, MechanicKey> = {
        damage: 'damage',
        interval_seconds: 'attackInterval',
        range: 'attackRange',
        enemy_hp: 'enemyHp',
        enemy_speed: 'enemySpeed',
      };
      for (const [key, value] of Object.entries(combat)) {
        if (key === 'auto_attack') {
          if (value !== (spec.game.genre === 'survivor'))
            gaps.push('自动攻击方式与所选玩法不符');
        } else if (!fields[key]) gaps.push(`未接入战斗参数：${key}`);
        else {
          try {
            validateMechanics({ [fields[key]]: value });
          } catch {
            gaps.push(`战斗参数超出范围：${key}`);
          }
        }
      }
      const xp =
        spec.systems.find((item) => item.enabled && item.type === 'xp')
          ?.config ?? {};
      for (const [key, value] of Object.entries(xp)) {
        if (key !== 'per_level') gaps.push(`未接入经验参数：${key}`);
        else
          try {
            validateMechanics({ xpPerLevel: value });
          } catch {
            gaps.push('升级经验超出范围');
          }
      }
    }
  }
  gaps.push(...assessMechanisms(spec).gaps, ...assessRules(spec));
  const design = spec.extensions?.gamerhub_design as
    | { executionGaps?: unknown }
    | undefined;
  if (Array.isArray(design?.executionGaps))
    gaps.push(
      ...design.executionGaps
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 10),
    );
  return {
    genre: profile.genre,
    name: profile.name,
    runtime: profile.runtime,
    executable: gaps.length === 0,
    status: gaps.length
      ? 'unsupported'
      : development.length
        ? 'requires_development'
        : 'ready',
    development,
    gaps,
  };
}
export function gameplayProfile(
  spec: GameSpec,
): GameCapability & { runtime: string; testFilter: string } {
  const assessment = assessGameCapabilities(spec);
  if (!assessment.executable)
    throw Object.assign(new Error('GAME_CAPABILITY_MISSING'), {
      code: 'GAME_CAPABILITY_MISSING',
      statusCode: 409,
    });
  return capabilityFor(spec.game.genre) as GameCapability & {
    runtime: string;
    testFilter: string;
  };
}

export function gameplayTestSuites(spec: GameSpec) {
  const profile = gameplayProfile(spec);
  const creative = specCreative(spec);
  return [
    {
      mode: 'playmode' as const,
      testFilter: profile.testFilter,
      minimumPassed: profile.minimumPlaymodeTests,
    },
    ...(creative.nodes.length + creative.sounds.length + creative.clips.length >
    0
      ? [
          {
            mode: 'playmode' as const,
            testFilter: 'CreativePlayModeTests',
            minimumPassed: 4,
          },
        ]
      : []),
    ...developmentFor(spec).map((item) => ({
      mode: 'playmode' as const,
      testFilter: `GamerHub.Generated.${item.id}Tests`,
      minimumPassed: 2,
    })),
  ];
}
