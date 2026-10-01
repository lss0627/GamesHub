import { runnerGameSpec } from './runner-fixture';
import type { GameSpec } from './types';

export interface RequirementInterpretation {
  intent: 'create' | 'modify' | 'out_of_scope';
  spec: GameSpec;
  summary: string;
  unsupportedReasons: string[];
}

export type RequirementInterpreter = (
  prompt: string,
  currentSpec?: GameSpec,
) => RequirementInterpretation | Promise<RequirementInterpretation>;

const unsupportedPatterns = [
  {
    pattern: /boss|多人|联机|mmo|online|multiplayer/i,
    reason: '多人或 Boss 内容不在 Runner MVP 范围内',
  },
  {
    pattern: /3d|三维|主机|console|mobile native|移动端原生|godot|unreal/i,
    reason: '仅支持 Unity 2D Web Runner',
  },
  {
    pattern: /new enemy|新敌人|敌人类型/i,
    reason: 'Runner MVP 不支持新增敌人类型',
  },
];

export function interpretRunnerPrompt(
  prompt: string,
  currentSpec?: GameSpec,
): RequirementInterpretation {
  const unsupportedReasons = unsupportedPatterns
    .filter(({ pattern }) => pattern.test(prompt))
    .map(({ reason }) => reason);
  const intent = currentSpec
    ? unsupportedReasons.length > 0
      ? 'out_of_scope'
      : 'modify'
    : unsupportedReasons.length > 0
      ? 'out_of_scope'
      : 'create';
  if (intent === 'out_of_scope') {
    return {
      intent,
      spec: structuredClone(currentSpec ?? runnerGameSpec),
      summary: '请求超出当前 Unity 2D Runner 范围',
      unsupportedReasons,
    };
  }
  if (!currentSpec)
    return {
      intent,
      spec: structuredClone(runnerGameSpec),
      summary: '创建 Unity 2D Runner 游戏',
      unsupportedReasons: [],
    };
  const next = structuredClone(currentSpec);
  const assetMatch =
    /(?:替换|换成|replace)[\s\S]{0,40}?(?:素材|asset)\s*(?:id|编号)?\s*[:#：]?\s*([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(
      prompt,
    );
  if (assetMatch?.[1]) {
    const logicalAssetId = assetMatch[1];
    next.player.appearance.logical_asset_id = logicalAssetId;
    if (!next.assets.some((asset) => asset.logical_id === logicalAssetId))
      next.assets.push({
        logical_id: logicalAssetId,
        type: 'sprite',
        source: 'upload',
      });
  }
  if (/jump|跳|跳跃/i.test(prompt)) {
    const match = prompt.match(
      /(?:jump|跳(?:跃|得)?)[^0-9]{0,12}(\d+(?:\.\d+)?)/i,
    );
    const requested = match?.[1]
      ? Number(match[1])
      : next.player.movement.jump_height * 0.75;
    next.player.movement.jump_height = Math.max(0, Math.min(100, requested));
  }
  const scoreMatch = prompt.match(
    /(?:金币.*?(?:分数|得分)|coin.*?score)[^0-9]{0,12}(\d+)/i,
  );
  if (scoreMatch?.[1]) {
    const requested = Number(scoreMatch[1]);
    const coinSystem = next.systems.find(
      (system) => system.system_id === 'coin_collection',
    );
    if (coinSystem) coinSystem.config.score_per_coin = Math.max(0, requested);
  }
  return {
    intent,
    spec: next,
    summary: assetMatch?.[1]
      ? '替换 Runner 角色素材'
      : '局部修改 Runner 游戏参数',
    unsupportedReasons: [],
  };
}
