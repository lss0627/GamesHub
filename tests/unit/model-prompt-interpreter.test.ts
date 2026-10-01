import {
  buildDesignSpec,
  initialBrief,
  runnerGameSpec,
} from '@gamerhub/game-spec';
import type {
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
} from '@gamerhub/model-provider';
import { describe, expect, it } from 'vitest';
import {
  ModelPromptInterpreter,
  MultiGenrePromptInterpreter,
} from '../../apps/orchestrator-worker/src/model/prompt-interpreter';

it('raw Agent requests preserve the selected genre and combat parameters', async () => {
  const current = buildDesignSpec({
    ...initialBrief,
    genre: 'survivor',
    mechanics: { damage: 2 },
  });
  const interpreter = new MultiGenrePromptInterpreter(
    providerFor({
      summary: '增加攻击伤害',
      brief: { ...initialBrief, genre: 'survivor', mechanics: { damage: 3 } },
    }),
  );
  const result = await interpreter.interpret('只增加攻击伤害', current);
  expect(result.intent).toBe('modify');
  expect(result.spec.game.genre).toBe('survivor');
  expect(
    result.spec.systems.find((system) => system.type === 'combat')?.config
      .damage,
  ).toBe(3);
});

function providerFor(
  decision: Record<string, unknown>,
  onGenerate?: (request: ModelRequest) => void,
): ModelProvider {
  return {
    providerId: 'deepseek',
    listModels: async () => [],
    countTokens: async () => ({ promptTokens: null }),
    health: async () => ({ status: 'ready', providerId: 'deepseek' }),
    async *generate(request): AsyncIterable<ModelStreamEvent> {
      onGenerate?.(request);
      yield {
        type: 'text_delta',
        payload: { text: JSON.stringify(decision) },
      };
      yield { type: 'message_complete', payload: {} };
    },
  };
}

function textProvider(
  responses: string[],
  onGenerate?: (request: ModelRequest) => void,
): ModelProvider {
  let index = 0;
  return {
    providerId: 'deepseek',
    listModels: async () => [],
    countTokens: async () => ({ promptTokens: null }),
    health: async () => ({ status: 'ready', providerId: 'deepseek' }),
    async *generate(request): AsyncIterable<ModelStreamEvent> {
      onGenerate?.(request);
      const text = responses[Math.min(index, responses.length - 1)] ?? '';
      index += 1;
      yield { type: 'text_delta', payload: { text } };
      yield { type: 'message_complete', payload: {} };
    },
  };
}

describe('DeepSeek Runner prompt interpreter', () => {
  it('applies only schema-validated Runner parameter changes', async () => {
    let observedRequest: ModelRequest | undefined;
    const interpreter = new ModelPromptInterpreter(
      providerFor(
        {
          intent: 'create',
          summary: '创建霓虹跑酷游戏',
          unsupportedReasons: [],
          changes: {
            gameName: '霓虹跃迁',
            jumpHeight: 9,
            scorePerCoin: 25,
          },
        },
        (request) => {
          observedRequest = request;
        },
      ),
    );

    const result = await interpreter.interpret('创建一个霓虹跑酷游戏');
    expect(result.intent).toBe('create');
    expect(result.spec.game.name).toBe('霓虹跃迁');
    expect(result.spec.player.movement.jump_height).toBe(9);
    expect(
      result.spec.systems.find(
        (system) => system.system_id === 'coin_collection',
      )?.config.score_per_coin,
    ).toBe(25);
    expect(observedRequest?.role).toBe('planner');
    expect(observedRequest?.outputSchema?.type).toBe('object');
  });

  it('rejects locally known out-of-scope requests before calling DeepSeek', async () => {
    let calls = 0;
    const interpreter = new ModelPromptInterpreter(
      providerFor(
        {
          intent: 'create',
          summary: '不应调用',
          unsupportedReasons: [],
          changes: {},
        },
        () => {
          calls += 1;
        },
      ),
    );

    const result = await interpreter.interpret('制作一个 3D 多人联机 MMO');
    expect(result.intent).toBe('out_of_scope');
    expect(calls).toBe(0);
  });

  it('rejects model values outside the bounded Runner schema', async () => {
    const interpreter = new ModelPromptInterpreter(
      providerFor({
        intent: 'create',
        summary: '越界值',
        unsupportedReasons: [],
        changes: { jumpHeight: 10000 },
      }),
    );

    await expect(interpreter.interpret('制作跑酷游戏')).rejects.toThrow(
      /MODEL_OUTPUT_INVALID/,
    );
  });

  it('accepts fenced structured JSON and retries one malformed response', async () => {
    let calls = 0;
    const valid = JSON.stringify({
      intent: 'create',
      summary: '创建原创横版跑酷',
      unsupportedReasons: [],
      changes: { gameName: '星轨跑酷' },
    });
    const interpreter = new ModelPromptInterpreter(
      textProvider([valid.slice(0, -1), `\`\`\`json\n${valid}\n\`\`\``], () => {
        calls += 1;
      }),
    );

    const result = await interpreter.interpret('创建原创横版跑酷');
    expect(calls).toBe(2);
    expect(result.spec.game.name).toBe('星轨跑酷');
  });

  it('turns broad named-game comparisons into an original bounded Runner change', async () => {
    const current = structuredClone(runnerGameSpec);
    const interpreter = new ModelPromptInterpreter(
      providerFor({
        intent: 'modify',
        summary: '未指定具体参数',
        unsupportedReasons: [],
        changes: {},
      }),
    );

    const result = await interpreter.interpret(
      '做一个天天酷跑类似的游戏',
      current,
    );
    expect(result.intent).toBe('modify');
    expect(result.summary).toBe('转换为原创横版无尽跑酷玩法');
    expect(result.spec.game.name).toBe('星跃酷跑');
    expect(result.spec.game.description).toContain('原创横版无尽跑酷');
    expect(result.spec.game.description).not.toContain('天天酷跑');
    expect(result.spec.player.movement.speed).not.toBe(
      current.player.movement.speed,
    );
  });
});
