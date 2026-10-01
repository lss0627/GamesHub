import { parseGameSpec } from '@gamerhub/contracts';
import type { ArtCandidate } from './art-plan';
import type { CreativeDocument } from './creative';
import {
  developmentFor,
  type MechanismDevelopment,
  validateDevelopment,
} from './development';
import {
  assessGameCapabilities,
  capabilityFor,
  type GameGenre,
  type GameMechanics,
  validateMechanics,
} from './game-capabilities';
import { presetRules, supportedBriefMechanics } from './mechanism-registry';
import { runnerGameSpec } from './runner-fixture';
import type { GameSpec } from './types';

export interface DesignBrief {
  development?: MechanismDevelopment[];
  genre?: GameGenre;
  mechanics?: GameMechanics;
  requestedFeatures?: string[];
  executionGaps?: string[];
  name: string;
  description: string;
  difficulty: string;
  duration: number;
  speed: number;
  jump: number;
  interval: number;
  coinScore: number;
}
export interface DesignDocument {
  creative?: CreativeDocument;
  creationMode?: 'quick' | 'discuss';
  appliedGenre?: GameGenre;
  revision: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  choices: string[];
  brief: DesignBrief;
  spec?: GameSpec;
  markdown?: string;
  confirmedRunId?: string;
  baseSpecId?: string;
  artRevision?: number;
  artCandidateId?: string;
}
export const initialBrief: DesignBrief = {
  name: '猫咪的森林冒险',
  description: '帮助小猫穿过森林，跳过木桩、收集金币，坚持到终点。',
  difficulty: '轻松入门',
  duration: 60,
  speed: 5,
  jump: 7,
  interval: 2.8,
  coinScore: 10,
};
export function validateBrief(input: unknown): DesignBrief {
  if (!input || typeof input !== 'object') throw new Error('DESIGN_INVALID');
  const b = input as Record<string, unknown>;
  const development = validateDevelopment(b.development);
  if (b.genre !== undefined) capabilityFor(b.genre as GameGenre);
  const mechanics =
    b.mechanics === undefined ? undefined : validateMechanics(b.mechanics);
  if (
    b.genre &&
    mechanics &&
    Object.keys(mechanics).some(
      (key) => !supportedBriefMechanics(b.genre as GameGenre).includes(key),
    )
  )
    throw new Error('DESIGN_MECHANIC_UNSUPPORTED');
  for (const key of ['requestedFeatures', 'executionGaps'])
    if (
      b[key] !== undefined &&
      (!Array.isArray(b[key]) ||
        b[key].length > 10 ||
        b[key].some(
          (item: unknown) => typeof item !== 'string' || item.length > 200,
        ))
    )
      throw new Error('DESIGN_INVALID');
  for (const key of ['name', 'description', 'difficulty'])
    if (
      typeof b[key] !== 'string' ||
      !b[key].trim() ||
      b[key].length > (key === 'description' ? 600 : 80)
    )
      throw new Error('DESIGN_INVALID');
  for (const [key, min, max] of [
    ['duration', 30, 180],
    ['speed', 3, 9],
    ['jump', 6, 10],
    ['interval', 1.5, 4],
    ['coinScore', 1, 100],
  ] as const)
    if (
      typeof b[key] !== 'number' ||
      !Number.isFinite(b[key]) ||
      b[key] < min ||
      b[key] > max
    )
      throw new Error('DESIGN_INVALID');
  return {
    ...(b.development === undefined ? {} : { development }),
    ...(b.genre === undefined ? {} : { genre: b.genre as GameGenre }),
    ...(mechanics ? { mechanics } : {}),
    ...(b.requestedFeatures === undefined
      ? {}
      : { requestedFeatures: b.requestedFeatures as string[] }),
    ...(b.executionGaps === undefined
      ? {}
      : { executionGaps: b.executionGaps as string[] }),
    name: b.name as string,
    description: b.description as string,
    difficulty: b.difficulty as string,
    duration: b.duration as number,
    speed: b.speed as number,
    jump: b.jump as number,
    interval: b.interval as number,
    coinScore: Math.round(b.coinScore as number),
  };
}
export function buildDesignSpec(
  brief: DesignBrief,
  current?: GameSpec,
): GameSpec {
  const genre = brief.genre ?? current?.game.genre ?? 'runner';
  const profile = capabilityFor(genre);
  const spec = structuredClone(current ?? runnerGameSpec);
  const m = brief.mechanics ?? {};
  spec.game.genre = genre;
  spec.game.template = profile.runtime ?? `design-${genre}`;
  spec.player.movement.type = profile.movement;
  spec.player.health.max_hp = genre === 'runner' ? 1 : (m.maxHp ?? 5);
  if (genre !== 'runner') {
    spec.systems = profile.systems.length
      ? profile.systems.map((type) => ({
          system_id: type,
          type: type as GameSpec['systems'][number]['type'],
          enabled: true,
          config: {},
        }))
      : [
          {
            system_id: 'game_over',
            type: 'game_over',
            enabled: true,
            config: {},
          },
        ];
    for (const system of spec.systems) {
      if (system.type === 'combat')
        system.config = {
          damage: m.damage ?? 1,
          interval_seconds: m.attackInterval ?? 0.7,
          range: genre === 'tower_defense' ? 3.6 : (m.attackRange ?? 5),
          auto_attack: genre === 'survivor' || genre === 'tower_defense',
          enemy_hp: m.enemyHp ?? 2,
          enemy_speed: m.enemySpeed ?? 1,
        };
      if (system.type === 'xp')
        system.config = { per_level: m.xpPerLevel ?? 3 };
      if (system.type === 'level_up')
        system.config =
          genre === 'clicker'
            ? { upgrade_cost: m.upgradeCost ?? 30 }
            : { choices: ['damage', 'speed', 'heal', 'multishot'] };
      if (system.type === 'wave')
        system.config = { count: 5, initial_currency: 100, build_cost: 30 };
      if (system.type === 'checkpoint')
        system.config =
          genre === 'puzzle'
            ? { undo: true, layout: 'sokoban-1' }
            : { positions: [13, 26], exit_x: 43 };
      if (system.type === 'dialogue')
        system.config = { story: 'star-lantern-1', inventory: ['star_key'] };
      if (system.type === 'score' && genre === 'clicker')
        system.config = {
          per_click: brief.coinScore,
          goal: m.goal ?? 300,
          auto_income: m.autoIncome ?? 0,
        };
    }
    spec.level.scene_id = `${genre}_scene`;
    spec.level.entities = [
      { entity_id: 'player', type: 'player', count: 1 },
      ...(profile.runtime === 'arena-v1'
        ? [
            { entity_id: 'enemy', type: 'enemy', count: 30 },
            { entity_id: 'experience', type: 'pickup', count: 30 },
          ]
        : []),
    ];
    spec.rules = {
      win_conditions: [
        {
          condition_id: 'reach_target',
          type: genre === 'clicker' ? 'score_at_least' : 'survive_seconds',
          parameters:
            genre === 'clicker'
              ? { score: m.goal ?? 300 }
              : { seconds: brief.duration },
        },
      ],
      lose_conditions: [
        {
          condition_id: genre === 'clicker' ? 'time_limit' : 'player_defeated',
          type: genre === 'clicker' ? 'time_expired' : 'player_hp_zero',
          parameters: genre === 'clicker' ? { seconds: brief.duration } : {},
        },
      ],
    };
    spec.ui = {
      hud: ['score', 'health', 'timer', 'level'],
      game_over: true,
      restart: true,
    };
    const rules = presetRules(genre, brief.duration);
    if (rules) {
      const conditions = (
        items: Record<string, Record<string, unknown>>,
        prefix: string,
      ): GameSpec['rules']['win_conditions'] =>
        Object.entries(items).map(([type, parameters], index) => ({
          condition_id: `${prefix}_${index}`,
          type: type as GameSpec['rules']['win_conditions'][number]['type'],
          parameters,
        }));
      spec.rules = {
        win_conditions: conditions(rules.win, 'win'),
        lose_conditions: conditions(rules.lose, 'lose'),
      };
    }
    spec.verification = [
      {
        assertion_id: 'gameplay_contract',
        capability: 'play.state',
        severity: 'critical',
        preconditions: [],
        actions: [
          {
            type: 'run_gameplay_contract',
            profile: profile.runtime ?? 'unavailable',
          },
        ],
        expected: [
          {
            type: 'profile_assertions_pass',
            minimum: profile.minimumPlaymodeTests,
          },
        ],
      },
      ...runnerGameSpec.verification.filter(
        (item) => item.assertion_id === 'web_preview_loads',
      ),
    ];
  } else if (current && current.game.genre !== 'runner') {
    const art = spec.extensions?.gamerhub_art;
    Object.assign(spec, structuredClone(runnerGameSpec));
    if (art) spec.extensions = { gamerhub_art: art };
  }
  if (brief.genre || brief.executionGaps || brief.requestedFeatures)
    spec.extensions = {
      ...spec.extensions,
      gamerhub_design: {
        requestedFeatures: brief.requestedFeatures ?? [],
        executionGaps: brief.executionGaps ?? [],
      },
    };
  spec.game.name = brief.name;
  if (brief.development !== undefined) {
    const requested = validateDevelopment(brief.development);
    if (
      current &&
      developmentFor(current).some(
        (item) => !requested.some((next) => next.id === item.id),
      )
    )
      throw new Error('DEVELOPMENT_REMOVAL_REQUIRES_PLAN');
    spec.extensions = {
      ...spec.extensions,
      gamerhub_development: requested.map((item) => ({
        ...item,
        acceptanceVersion: 1,
      })),
    };
  }
  spec.game.description = brief.description;
  spec.player.movement.speed = brief.speed;
  spec.player.movement.jump_height =
    genre === 'runner' || genre === 'platformer' ? brief.jump : 0;
  spec.level.duration_seconds = brief.duration;
  for (const system of spec.systems) {
    if (system.type === 'coin_collection')
      system.config.score_per_coin = brief.coinScore;
    if (system.type === 'spawn')
      system.config.interval_seconds = brief.interval;
  }
  for (const condition of spec.rules.win_conditions)
    if (condition.type === 'survive_seconds')
      condition.parameters.seconds = brief.duration;
  for (const asset of spec.assets)
    if (asset.logical_id === 'cat_player' && !asset.asset_id)
      asset.source = 'builtin';
  return parseGameSpec(spec);
}
export function presetParameterText(brief: DesignBrief): string {
  const m = brief.mechanics ?? {};
  switch (brief.genre) {
    case 'flappy':
      return `每${brief.interval}秒出现一道门，移动速度${brief.speed}；穿过8道门通关，碰撞或越界失败。`;
    case 'breakout':
      return `24块砖、${m.maxHp ?? 5}次生命，挡板速度基数${brief.speed}；全部击碎通关，漏球扣一次生命。`;
    case 'platformer':
      return `移动速度${brief.speed}，跳跃力度${brief.jump}，生命${m.maxHp ?? 5}；金币每枚${brief.coinScore}分，两个检查点，终点位于43。`;
    case 'tower_defense':
      return `共5波，基地生命${m.maxHp ?? 5}；初始金币100、建塔30，可升至3级。攻击伤害${m.damage ?? 1}、间隔${m.attackInterval ?? 0.7}秒、射程3.6；敌人初始生命${m.enemyHp ?? 2}、速度基数${m.enemySpeed ?? 1}。`;
    case 'puzzle':
      return '固定8×6推箱子关卡，3个箱子和3个目标；支持撤销和重开，时限内全部归位通关。';
    case 'rpg_dialogue':
      return '星灯故事包含森林、营地、河边及两个结局；帮助狐狸获得钥匙，开门成功；风暴路线失败。';
    default:
      return (brief.requestedFeatures ?? [])
        .map((item) => `- ${item}`)
        .join('\n');
  }
}

export function designMarkdown(brief: DesignBrief, art?: ArtCandidate): string {
  const profile = capabilityFor(brief.genre ?? 'runner');
  if (profile.genre !== 'runner') {
    const spec = buildDesignSpec(brief);
    const assessment = assessGameCapabilities(spec);
    const m = brief.mechanics ?? {};
    return `# ${brief.name} · 制作说明（Spec）\n\n## 游戏体验\n${brief.description}\n\n## 类型与核心循环\n${profile.name}：${profile.loop}\n\n## 操作与目标\n${profile.instructions}\n一局${brief.duration}秒。\n\n## 玩法参数\n${profile.runtime === 'arena-v1' ? `生命${m.maxHp ?? 5}；敌人每${brief.interval}秒出现，生命${m.enemyHp ?? 2}、速度${m.enemySpeed ?? 1}。\n每次攻击伤害${m.damage ?? 1}，间隔${m.attackInterval ?? 0.7}秒，范围${m.attackRange ?? 5}。\n敌人死亡掉落经验，收集${m.xpPerLevel ?? 3}点后升级，选择伤害、攻速、回血或多重攻击；选择时战斗暂停。` : profile.runtime === 'clicker-v1' ? `每次收集${brief.coinScore}，初始自动收益${m.autoIncome ?? 0}/秒；升级初始花费${m.upgradeCost ?? 30}，目标${m.goal ?? 300}。` : presetParameterText(brief)}\n\n## 美术与素材\n${art ? `选用「${art.name}」，来源${art.source === 'builtin' ? '内置原创素材配色' : '图片生成服务'}。` : '使用内置原创素材完成可玩原型；可在素材面板换色或选图。'}\n素材按当前玩法绑定：${profile.runtime === 'arena-v1' ? '角色、背景、经验收集物、追踪敌人' : '主题角色、背景、资源图标、升级图标'}；图形是原型素材，不意味着全新主题或动画已经生成。\n\n## 制作与验收\n${assessment.executable ? `组装${profile.name}运行时，检查实际玩法、胜负、重玩及网页构建，全部通过才发布。` : assessment.gaps.map((gap) => `- 待接入：${gap}`).join('\n')}\n历史版本保持可恢复。\n`;
  }
  const artDescription = art
    ? `- 采用「${art.name}」成套素材，来源：${art.source === 'builtin' ? '内置素材库 · 自动配色' : '图片生成服务'}。\n- 角色、场景、金币和木桩使用此方案的四张图片；确认后制作，成功发布后才标记为当前使用。`
    : '- 默认使用温暖的手绘森林：橘猫、金色硬币、木桩、远山与草地。\n- 可先去角色与素材面板自动准备其他方案；自行上传为可选，上传本身不会替换角色。';
  return `# ${brief.name} · 制作说明（Spec）\n\n## 游戏体验\n${brief.description}\n\n## 玩法与目标\n- 2D 横版森林跑酷，场景自动向左移动。\n- 左右方向键 / A、D 调整位置，空格跳跃；触屏可用方向和跳跃按钮；P / Esc 或暂停按钮暂停。\n- 收集一枚金币得到 ${brief.coinScore} 分；碰到木桩失败，坚持 ${brief.duration} 秒通关。\n- 开始前显示操作说明，点击开始后计时；结束后显示成绩并可重玩。\n\n## 难度与节奏\n- 难度：${brief.difficulty}\n- 移动速度：${brief.speed}；跳跃力度：${brief.jump}\n- 道具或障碍每 ${brief.interval} 秒出现一次。\n\n## 美术与素材\n${artDescription}\n\n## 制作与验收\n1. 按这份已确认的说明更新游戏配置和 Unity 场景。\n2. 编译并检查移动、跳跃、碰撞、得分、重玩与网页加载。\n3. 检查通过后发布试玩版本，保留历史版本供恢复。\n\n## 当前边界\n当前方案使用跑酷能力；其他类型可以重新讨论并选择相应玩法模块，系统不会擅自更改已确认类型。\n`;
}
const approvedPrefix = 'GAMERHUB_APPROVED_SPEC_V1\n';
export function encodeApprovedSpec(spec: GameSpec): string {
  return approvedPrefix + JSON.stringify(parseGameSpec(spec));
}
export function decodeApprovedSpec(prompt: string): GameSpec | undefined {
  return prompt.startsWith(approvedPrefix)
    ? parseGameSpec(JSON.parse(prompt.slice(approvedPrefix.length)))
    : undefined;
}
