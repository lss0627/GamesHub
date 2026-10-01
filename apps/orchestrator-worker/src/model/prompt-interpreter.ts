import { randomUUID } from 'node:crypto';
import { parseGameSpec } from '@gamerhub/contracts';
import {
  assessGameCapabilities,
  buildDesignSpec,
  decodeApprovedSpec,
  type GameSpec,
  gameCapabilities,
  initialBrief,
  interpretRunnerPrompt,
  mechanicRanges,
  type RequirementInterpretation,
  type RequirementInterpreter,
  runnerGameSpec,
  semanticDiff,
  validateBrief,
} from '@gamerhub/game-spec';
import {
  type ConfiguredModelProvider,
  type ConfiguredModelProviderOptions,
  createConfiguredModelProvider,
  type ModelProvider,
  ModelProviderError,
  parseStructuredJsonText,
} from '@gamerhub/model-provider';

interface RunnerPromptChanges {
  gameName?: string;
  description?: string;
  playerSpeed?: number;
  jumpHeight?: number;
  scorePerCoin?: number;
  spawnIntervalSeconds?: number;
  levelDurationSeconds?: number;
  playerAssetId?: string;
}

interface RunnerPromptDecision {
  intent: 'create' | 'modify' | 'out_of_scope';
  summary: string;
  unsupportedReasons: string[];
  changes: RunnerPromptChanges;
}

export interface ConfiguredPromptInterpreter {
  configuration: ConfiguredModelProvider;
  interpret: RequirementInterpreter;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'DeepSeek prompt decision must be a JSON object',
    );
  return value as Record<string, unknown>;
}

function optionalNumber(
  value: unknown,
  name: string,
  range: { min: number; max: number; integer?: boolean },
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max ||
    (range.integer && !Number.isInteger(value))
  )
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      `${name} is outside the supported Runner range`,
    );
  return value;
}

function optionalString(
  value: unknown,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      `${name} must be a non-empty string of at most ${maxLength} characters`,
    );
  return value.trim();
}

function parseDecision(text: string): RunnerPromptDecision {
  const value = parseStructuredJsonText(text);
  const root = record(value);
  const intent = root.intent;
  if (!['create', 'modify', 'out_of_scope'].includes(String(intent)))
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'DeepSeek prompt decision contains an invalid intent',
    );
  const summary = optionalString(root.summary, 'summary', 500);
  if (!summary)
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'DeepSeek prompt decision requires a summary',
    );
  if (!Array.isArray(root.unsupportedReasons))
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'unsupportedReasons must be an array',
    );
  const unsupportedReasons = root.unsupportedReasons.map((reason) => {
    const parsed = optionalString(reason, 'unsupportedReason', 300);
    if (!parsed)
      throw new ModelProviderError(
        'MODEL_OUTPUT_INVALID',
        'unsupportedReasons cannot contain empty values',
      );
    return parsed;
  });
  const changes = record(root.changes);
  const gameName = optionalString(changes.gameName, 'gameName', 120);
  const description = optionalString(changes.description, 'description', 2000);
  const playerSpeed = optionalNumber(changes.playerSpeed, 'playerSpeed', {
    min: 0.1,
    max: 1000,
  });
  const jumpHeight = optionalNumber(changes.jumpHeight, 'jumpHeight', {
    min: 0,
    max: 100,
  });
  const scorePerCoin = optionalNumber(changes.scorePerCoin, 'scorePerCoin', {
    min: 0,
    max: 1_000_000,
    integer: true,
  });
  const spawnIntervalSeconds = optionalNumber(
    changes.spawnIntervalSeconds,
    'spawnIntervalSeconds',
    { min: 0.1, max: 3600 },
  );
  const levelDurationSeconds = optionalNumber(
    changes.levelDurationSeconds,
    'levelDurationSeconds',
    { min: 10, max: 3600, integer: true },
  );
  const playerAssetId = optionalString(
    changes.playerAssetId,
    'playerAssetId',
    64,
  );
  if (playerAssetId && !/^[a-z][a-z0-9_]{1,63}$/.test(playerAssetId))
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'playerAssetId must be a safe logical asset id',
    );
  return {
    intent: intent as RunnerPromptDecision['intent'],
    summary,
    unsupportedReasons,
    changes: {
      ...(gameName ? { gameName } : {}),
      ...(description ? { description } : {}),
      ...(playerSpeed !== undefined ? { playerSpeed } : {}),
      ...(jumpHeight !== undefined ? { jumpHeight } : {}),
      ...(scorePerCoin !== undefined ? { scorePerCoin } : {}),
      ...(spawnIntervalSeconds !== undefined ? { spawnIntervalSeconds } : {}),
      ...(levelDurationSeconds !== undefined ? { levelDurationSeconds } : {}),
      ...(playerAssetId ? { playerAssetId } : {}),
    },
  };
}

function originalRunnerPreset(
  prompt: string,
  currentSpec?: GameSpec,
): RunnerPromptChanges | undefined {
  if (
    !/(?:天天酷跑|酷跑|跑酷|endless\s*runner|temple\s*run|subway\s*surfers)/i.test(
      prompt,
    )
  )
    return undefined;
  const currentSpeed = currentSpec?.player.movement.speed;
  const playerSpeed =
    currentSpeed === undefined
      ? 8
      : currentSpeed < 12
        ? Math.min(12, currentSpeed + 1)
        : Math.max(8, currentSpeed - 1);
  const currentScore = currentSpec?.systems.find(
    (system) => system.system_id === 'coin_collection',
  )?.config.score_per_coin;
  const currentSpawn = currentSpec?.systems.find(
    (system) => system.system_id === 'spawn',
  )?.config.interval_seconds;
  const currentDuration = currentSpec?.level.duration_seconds;
  return {
    gameName: currentSpec?.game.name === '星跃酷跑' ? '霓虹追光者' : '星跃酷跑',
    description:
      '原创横版无尽跑酷：角色自动前进，跳跃躲避障碍并收集金币；不包含第三方品牌、角色或素材。',
    playerSpeed,
    jumpHeight: 6,
    scorePerCoin: currentScore === 25 ? 30 : 25,
    spawnIntervalSeconds: currentSpawn === 1.5 ? 1.25 : 1.5,
    levelDurationSeconds: currentDuration === 60 ? 75 : 60,
  };
}

function applyDecision(
  decision: RunnerPromptDecision,
  currentSpec?: GameSpec,
): RequirementInterpretation {
  const expectedIntent = currentSpec ? 'modify' : 'create';
  if (decision.intent === 'out_of_scope')
    return {
      intent: 'out_of_scope',
      spec: structuredClone(currentSpec ?? runnerGameSpec),
      summary: decision.summary,
      unsupportedReasons:
        decision.unsupportedReasons.length > 0
          ? decision.unsupportedReasons
          : ['请求超出当前 Unity 2D Web Runner 范围'],
    };
  if (decision.intent !== expectedIntent)
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      `DeepSeek returned ${decision.intent} for a ${expectedIntent} request`,
    );

  const next = structuredClone(currentSpec ?? runnerGameSpec);
  const changes = decision.changes;
  if (changes.gameName !== undefined) next.game.name = changes.gameName;
  if (changes.description !== undefined)
    next.game.description = changes.description;
  if (changes.playerSpeed !== undefined)
    next.player.movement.speed = changes.playerSpeed;
  if (changes.jumpHeight !== undefined)
    next.player.movement.jump_height = changes.jumpHeight;
  if (changes.levelDurationSeconds !== undefined)
    next.level.duration_seconds = changes.levelDurationSeconds;
  const coinSystem = next.systems.find(
    (system) => system.system_id === 'coin_collection',
  );
  if (coinSystem && changes.scorePerCoin !== undefined)
    coinSystem.config.score_per_coin = changes.scorePerCoin;
  const spawnSystem = next.systems.find(
    (system) => system.system_id === 'spawn',
  );
  if (spawnSystem && changes.spawnIntervalSeconds !== undefined)
    spawnSystem.config.interval_seconds = changes.spawnIntervalSeconds;
  if (changes.playerAssetId !== undefined) {
    next.player.appearance.logical_asset_id = changes.playerAssetId;
    if (
      !next.assets.some((asset) => asset.logical_id === changes.playerAssetId)
    )
      next.assets.push({
        logical_id: changes.playerAssetId,
        type: 'sprite',
        source: 'upload',
      });
  }
  return {
    intent: expectedIntent,
    spec: parseGameSpec(next),
    summary: decision.summary,
    unsupportedReasons: [],
  };
}

export class ModelPromptInterpreter {
  constructor(
    private readonly provider: ModelProvider,
    private readonly options: { timeoutMs?: number; tokenBudget?: number } = {},
  ) {}

  async interpret(
    prompt: string,
    currentSpec?: GameSpec,
  ): Promise<RequirementInterpretation> {
    const localGuard = interpretRunnerPrompt(prompt, currentSpec);
    if (localGuard.intent === 'out_of_scope') return localGuard;
    const expectedIntent = currentSpec ? 'modify' : 'create';
    const currentValues = currentSpec
      ? {
          gameName: currentSpec.game.name,
          description: currentSpec.game.description,
          playerSpeed: currentSpec.player.movement.speed,
          jumpHeight: currentSpec.player.movement.jump_height,
          scorePerCoin: currentSpec.systems.find(
            (system) => system.system_id === 'coin_collection',
          )?.config.score_per_coin,
          spawnIntervalSeconds: currentSpec.systems.find(
            (system) => system.system_id === 'spawn',
          )?.config.interval_seconds,
          levelDurationSeconds: currentSpec.level.duration_seconds,
          playerAssetId: currentSpec.player.appearance.logical_asset_id,
        }
      : undefined;
    const systemPrompt =
      'You are the bounded requirement interpreter for a Unity 2D Web Runner creator. Return one complete JSON object only. Reject requests for 3D, multiplayer, bosses, new enemy types, other genres, native mobile/console, arbitrary code, network access, or capabilities outside the curated Runner template. Convert comparisons to named games into original generic Runner mechanics; never copy third-party brands, characters, art, text, audio, or levels. Allowed changes are gameName, description, playerSpeed, jumpHeight, scorePerCoin, spawnIntervalSeconds, levelDurationSeconds, and playerAssetId. For modify requests, changes must contain at least one supported field whose value differs from currentValues. Use exactly this shape: {"intent":"create|modify|out_of_scope","summary":"short Chinese summary","unsupportedReasons":[],"changes":{}}.';
    const preset = originalRunnerPreset(prompt, currentSpec);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let text = '';
      try {
        for await (const event of this.provider.generate({
          runId: `prompt-${randomUUID()}`,
          role: 'planner',
          messages: [
            { role: 'system', content: systemPrompt },
            ...(attempt > 0
              ? [
                  {
                    role: 'system' as const,
                    content:
                      'The previous response was malformed or produced no effective change. Repair it now: emit exactly one complete JSON object and make every modify value differ from currentValues.',
                  },
                ]
              : []),
            {
              role: 'user',
              content: JSON.stringify({
                expectedIntent,
                prompt,
                ...(currentValues ? { currentValues } : {}),
              }),
            },
          ],
          outputSchema: {
            type: 'object',
            required: ['intent', 'summary', 'unsupportedReasons', 'changes'],
          },
          tokenBudget: this.options.tokenBudget ?? 2048,
          timeoutMs: this.options.timeoutMs ?? 120_000,
          signal: new AbortController().signal,
        })) {
          if (
            event.type === 'text_delta' &&
            typeof event.payload.text === 'string'
          )
            text += event.payload.text;
        }
        const decision = parseDecision(text);
        const withPreset =
          preset && Object.keys(decision.changes).length === 0
            ? {
                ...decision,
                summary: '转换为原创横版无尽跑酷玩法',
                changes: preset,
              }
            : decision;
        let result = applyDecision(withPreset, currentSpec);
        if (
          currentSpec &&
          semanticDiff(currentSpec, result.spec).changedPaths.length === 0 &&
          preset
        )
          result = applyDecision(
            {
              ...decision,
              summary: '转换为原创横版无尽跑酷玩法',
              changes: preset,
            },
            currentSpec,
          );
        if (
          currentSpec &&
          semanticDiff(currentSpec, result.spec).changedPaths.length === 0
        )
          throw new ModelProviderError(
            'MODEL_OUTPUT_INVALID',
            'DeepSeek modification produced no effective Runner change',
          );
        return result;
      } catch (error) {
        lastError = error;
        if (
          attempt === 0 &&
          error instanceof ModelProviderError &&
          error.code === 'MODEL_OUTPUT_INVALID'
        )
          continue;
        throw error;
      }
    }
    throw lastError;
  }
}

/** Raw API requests use the same typed design boundary as the conversation UI. */
export class MultiGenrePromptInterpreter {
  constructor(
    private readonly provider: ModelProvider,
    private readonly options: { timeoutMs?: number; tokenBudget?: number } = {},
  ) {}
  async interpret(
    prompt: string,
    currentSpec?: GameSpec,
  ): Promise<RequirementInterpretation> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let text = '';
      for await (const event of this.provider.generate({
        runId: `prompt-${randomUUID()}`,
        role: 'planner',
        messages: [
          {
            role: 'system',
            content: `你是游戏设计Agent。根据请求返回完整JSON {summary:"中文摘要",brief:${JSON.stringify({ ...initialBrief, genre: 'survivor', mechanics: {}, requestedFeatures: [], executionGaps: [] })}}。可讨论所有游戏类型，不得把其他玩法改成跑酷。能力目录：${JSON.stringify(gameCapabilities)}。数值范围：[最小,最大,默认] ${JSON.stringify(mechanicRanges)}。duration30-180，speed3-9，jump6-10，interval1.5-4，coinScore1-100。mechanics只能有目录字段。已有游戏修改保留所有未要求更改的参数、类型和development。用户明确要求可编码机制时加入development:[{id:小写字母开头的2到41位字母数字下划线,description:具体行为,acceptance:2到6条行为验收,operation:implement}]。已有机制删除要保留id并设operation:retire，提供旧行为不再触发和其他功能正常的验收，不能静默从数组删除。运行时未实现的需求写入executionGaps，保留创意并解释，不声称完成。不要添加额外玩法。${attempt ? '上次结构无效，请修复JSON及范围。' : ''}`,
          },
          { role: 'user', content: JSON.stringify({ prompt, currentSpec }) },
        ],
        outputSchema: { type: 'object', required: ['summary', 'brief'] },
        tokenBudget: this.options.tokenBudget ?? 4096,
        timeoutMs: this.options.timeoutMs ?? 120000,
        signal: new AbortController().signal,
      })) {
        if (event.type === 'provider_error')
          throw new ModelProviderError(
            'MODEL_OUTPUT_INVALID',
            'Model request failed',
          );
        if (event.type === 'text_delta')
          text += String(event.payload.text ?? '');
      }
      try {
        const output = record(parseStructuredJsonText(text));
        const brief = validateBrief(output.brief);
        const spec = buildDesignSpec(brief, currentSpec);
        const assessment = assessGameCapabilities(spec);
        const summary = optionalString(output.summary, 'summary', 500);
        if (!summary) throw new Error('Missing summary');
        return {
          intent: assessment.executable
            ? currentSpec
              ? 'modify'
              : 'create'
            : 'out_of_scope',
          spec,
          summary,
          unsupportedReasons: assessment.gaps,
        };
      } catch {
        if (attempt === 1)
          throw new ModelProviderError(
            'MODEL_OUTPUT_INVALID',
            'Invalid game design response',
          );
      }
    }
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'Invalid game design response',
    );
  }
}

export function createConfiguredPromptInterpreter(
  source: Record<string, string | undefined> = process.env,
  options: ConfiguredModelProviderOptions = {},
): ConfiguredPromptInterpreter {
  const configuration = createConfiguredModelProvider(source, options);
  return {
    configuration,
    interpret: (prompt, currentSpec) => {
      const approved = decodeApprovedSpec(prompt);
      if (approved)
        return Promise.resolve({
          intent: currentSpec ? 'modify' : 'create',
          spec: approved,
          summary: '按已确认的制作说明执行',
          unsupportedReasons: [],
        });
      return (
        configuration.mode === 'deepseek'
          ? (prompt: string, currentSpec?: GameSpec) =>
              new MultiGenrePromptInterpreter(configuration.provider, {
                timeoutMs: Number(source.MODEL_REQUEST_TIMEOUT_MS ?? 120_000),
                tokenBudget: Math.min(
                  Number(source.MODEL_MAX_OUTPUT_TOKENS ?? 16_384),
                  12288,
                ),
              }).interpret(prompt, currentSpec)
          : (prompt: string, currentSpec?: GameSpec) =>
              Promise.resolve(interpretRunnerPrompt(prompt, currentSpec))
      )(prompt, currentSpec);
    },
  };
}
