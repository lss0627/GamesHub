import { InMemoryPlatformStore } from '@gamerhub/domain';
import {
  decodeApprovedSpec,
  emptyCreative,
  initialBrief,
  specCreative,
} from '@gamerhub/game-spec';
import type { ModelProvider, ModelRequest } from '@gamerhub/model-provider';
import { describe, expect, it } from 'vitest';
import { createConfiguredPromptInterpreter } from '../../apps/orchestrator-worker/src/model/prompt-interpreter';
import { createPlatformApi } from '../../apps/platform-api/src/app';
import { DesignService } from '../../apps/platform-api/src/services/design-service';

async function setup() {
  const store = new InMemoryPlatformStore();
  const ownerId = 'owner';
  const project = await store.createProject({
    ownerId,
    name: 'Guided game',
    slug: 'guided-game',
    quotaProfile: 'free',
  });
  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    providerId: 'test',
    listModels: async () => [],
    countTokens: async () => ({ promptTokens: null }),
    health: async () => ({ status: 'ready', providerId: 'test' }),
    async *generate(request) {
      requests.push(request);
      expect(request.tokenBudget).toBeGreaterThanOrEqual(8192);
      yield {
        type: 'text_delta',
        payload: {
          text: JSON.stringify({
            reply: '我们先设计轻松的一局，你希望玩多久？',
            choices: ['60秒就好'],
            brief: { ...initialBrief, coinScore: 25 },
          }),
        },
      };
    },
  };
  const api = createPlatformApi(
    { userId: ownerId, role: 'creator' },
    { store },
  );
  return {
    store,
    ownerId,
    project,
    requests,
    service: new DesignService(store, ownerId, api, provider),
    api,
    provider,
  };
}

it('persists creative drafts with revision conflicts and embeds them in the confirmed spec', async () => {
  const { service, project } = await setup();
  const initial = await service.message(project.id, 0, '制作轻松游戏');
  const doc = { ...emptyCreative(), masterVolume: 0.3 };
  const saved = await service.saveCreative(project.id, initial.revision, doc);
  expect((await service.getCreative(project.id)).document).toEqual(doc);
  await expect(
    service.saveCreative(project.id, initial.revision, doc),
  ).rejects.toMatchObject({ code: 'DESIGN_CHANGED' });
  const prepared = await service.prepare(project.id, saved.revision);
  expect(specCreative(prepared.spec).masterVolume).toBe(0.3);
  const confirmed = await service.confirm(project.id, prepared.revision);
  await expect(
    service.saveCreative(project.id, confirmed.revision, doc),
  ).rejects.toMatchObject({ code: 'PROJECT_RUN_ACTIVE' });
});

it('retains design-only ideas and refuses execution before admitting a run', async () => {
  const { service, provider, project, store, ownerId } = await setup();
  provider.generate = async function* () {
    yield {
      type: 'text_delta',
      payload: {
        text: JSON.stringify({
          reply: '先保留你的开放世界方案，需要补充对应运行时。',
          choices: [],
          brief: { ...initialBrief, genre: 'custom' },
        }),
      },
    };
  };
  let draft = await service.message(project.id, 0, '想做开放世界');
  draft = await service.message(project.id, draft.revision, '保留这个方案');
  draft = await service.prepare(project.id, draft.revision);
  expect(draft.spec?.game.genre).toBe('custom');
  await expect(
    service.confirm(project.id, draft.revision),
  ).rejects.toMatchObject({ code: 'GAME_CAPABILITY_MISSING' });
  expect(await store.listRuns(project.id, { ownerId })).toHaveLength(0);
});

it('rejects editing during an active run before calling the model', async () => {
  const { service, project, api, requests } = await setup();
  await api.request({
    method: 'POST',
    path: `/v1/projects/${project.id}/runs`,
    headers: { 'idempotency-key': 'active' },
    body: { request_type: 'create', prompt: '猫咪跑酷' },
  });
  await expect(service.message(project.id, 0, '改难度')).rejects.toMatchObject({
    code: 'PROJECT_RUN_ACTIVE',
  });
  await expect(service.prepare(project.id, 0)).rejects.toMatchObject({
    code: 'PROJECT_RUN_ACTIVE',
  });
  expect(requests).toHaveLength(0);
});

it('does not save a model reply if production starts while it is thinking', async () => {
  const { service, project, api, provider } = await setup();
  const original = provider.generate.bind(provider);
  provider.generate = async function* (request) {
    await api.request({
      method: 'POST',
      path: `/v1/projects/${project.id}/runs`,
      headers: { 'idempotency-key': 'race' },
      body: { request_type: 'create', prompt: '猫咪跑酷' },
    });
    yield* original(request);
  };
  await expect(service.message(project.id, 0, '先讨论')).rejects.toMatchObject({
    code: 'PROJECT_RUN_ACTIVE',
  });
  expect((await service.get(project.id)).revision).toBe(0);
});

it('passes full project history to the Python context assembler', async () => {
  const { service, project, requests } = await setup();
  for (let revision = 0; revision < 43; revision++)
    await service.message(project.id, revision, `讨论${revision}`);
  const saved = await service.get(project.id);
  expect(saved.messages).toHaveLength(86);
  expect(requests.at(-1)?.context).toEqual({ projectId: project.id });
  expect(
    requests.at(-1)?.messages.filter((m) => m.role !== 'system'),
  ).toHaveLength(85);
  expect(
    requests
      .at(-1)
      ?.messages.some((m) => m.role === 'user' && m.content === '讨论0'),
  ).toBe(true);
});

describe('guided creation admission', () => {
  it('prepares one complete sentence without admitting a run and records quick mode for the model', async () => {
    const { service, project, store, ownerId, requests } = await setup();
    await expect(service.prepare(project.id, 0)).rejects.toMatchObject({
      code: 'DESIGN_DISCUSS_FIRST',
    });
    let draft = await service.message(
      project.id,
      0,
      '做一个轻松的猫咪跑酷游戏',
      'quick',
    );
    expect(draft.creationMode).toBe('quick');
    expect(
      requests[0]?.messages.some(
        (message) =>
          message.role === 'system' && message.content.includes('一句话制作'),
      ),
    ).toBe(true);
    draft = await service.prepare(project.id, draft.revision);
    expect(
      draft.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(1);
    expect(draft.spec).toBeDefined();
    expect(await store.listRuns(project.id, { ownerId })).toHaveLength(0);
    const confirmed = await service.confirm(project.id, draft.revision);
    expect(await service.confirm(project.id, draft.revision)).toEqual(
      confirmed,
    );
    expect(await store.listRuns(project.id, { ownerId })).toHaveLength(1);
  });

  it('persists multiple turns without executing, then enqueues the exact reviewed Spec once', async () => {
    const { service, project, store, ownerId, requests } = await setup();
    await expect(service.confirm(project.id, 0)).rejects.toMatchObject({
      code: 'DESIGN_SPEC_REQUIRED',
    });
    let draft = await service.message(project.id, 0, '先聊聊玩法');
    draft = await service.message(project.id, draft.revision, '60秒，金币25分');
    expect(
      requests[1]?.messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content),
    ).toEqual(['先聊聊玩法', '60秒，金币25分']);
    expect((await service.get(project.id)).messages).toHaveLength(4);
    draft = await service.prepare(project.id, draft.revision);
    expect(await store.listRuns(project.id, { ownerId })).toHaveLength(0);
    const revision = draft.revision;
    const reviewed = draft.spec;
    const confirmed = await service.confirm(project.id, revision);
    expect(await service.confirm(project.id, revision)).toEqual(confirmed);
    const runs = await store.listRuns(project.id, { ownerId });
    expect(runs).toHaveLength(1);
    const admitted = runs[0];
    if (!admitted) throw new Error('RUN_MISSING');
    expect(decodeApprovedSpec(admitted.userInput)).toEqual(reviewed);
    const interpreter = createConfiguredPromptInterpreter({
      MODEL_PROVIDER_ID: 'local-fixture',
    });
    const interpreted = await interpreter.interpret(admitted.userInput);
    expect(interpreted.spec).toEqual(reviewed);
    expect(confirmed.markdown).toContain('25 分');
  });

  it('invalidates a prepared document when discussion changes and rejects stale tabs', async () => {
    const { service, project, store, ownerId } = await setup();
    let draft = await service.message(project.id, 0, '轻松一点');
    draft = await service.message(project.id, draft.revision, '60秒');
    draft = await service.prepare(project.id, draft.revision);
    const staleRevision = draft.revision;
    draft = await service.message(
      project.id,
      draft.revision,
      '我还想讨论一下难度',
    );
    expect(draft.spec).toBeUndefined();
    expect(draft.markdown).toBeUndefined();
    await expect(
      service.confirm(project.id, staleRevision),
    ).rejects.toMatchObject({ code: 'DESIGN_CHANGED' });
    await expect(
      service.confirm(project.id, draft.revision),
    ).rejects.toMatchObject({ code: 'DESIGN_SPEC_REQUIRED' });
    expect(await store.listRuns(project.id, { ownerId })).toHaveLength(0);
  });

  it('serializes competing writes and isolates projects by owner', async () => {
    const { service, project, store, api, provider } = await setup();
    const results = await Promise.allSettled([
      service.message(project.id, 0, '第一处修改'),
      service.message(project.id, 0, '第二处修改'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await service.get(project.id)).messages).toHaveLength(2);
    const outsider = new DesignService(store, 'other-owner', api, provider);
    await expect(outsider.get(project.id)).rejects.toThrow();
    await expect(outsider.confirm(project.id, 1)).rejects.toThrow();
  });

  it('does not save fabricated or malformed model decisions', async () => {
    const { store, ownerId, api, project, provider } = await setup();
    const broken: ModelProvider = {
      ...provider,
      async *generate() {
        yield {
          type: 'text_delta',
          payload: { text: '{"reply":"已经做好了"}' },
        };
      },
    };
    const service = new DesignService(store, ownerId, api, broken);
    await expect(
      service.message(project.id, 0, '开始讨论'),
    ).rejects.toMatchObject({ code: 'DESIGN_MODEL_INVALID' });
    expect((await service.get(project.id)).revision).toBe(0);
    expect(await store.listRuns(project.id, { ownerId })).toHaveLength(0);
  });
});

it('retries one malformed model envelope without saving a partial conversation', async () => {
  const { service, project, provider } = await setup();
  const generate = provider.generate.bind(provider);
  let attempts = 0;
  provider.generate = async function* (request) {
    if (++attempts === 1)
      throw Object.assign(new Error('MODEL_OUTPUT_INVALID'), {
        code: 'MODEL_OUTPUT_INVALID',
      });
    yield* generate(request);
  };
  const draft = await service.message(project.id, 0, '先讨论画风');
  expect(attempts).toBe(2);
  expect(draft.messages).toHaveLength(2);
  expect(draft.revision).toBe(1);
});

it('retries incomplete business JSON before saving any conversation', async () => {
  const { service, project, provider } = await setup();
  const generate = provider.generate.bind(provider);
  let attempts = 0;
  provider.generate = async function* (request) {
    if (++attempts === 1)
      yield {
        type: 'text_delta',
        payload: { text: '{"reply":"改为20分","brief":{"coinScore":20}}' },
      };
    else {
      expect(request.messages.at(-1)?.content).toContain('未通过格式校验');
      expect(request.messages.at(-2)?.role).toBe('assistant');
      yield* generate(request);
    }
  };
  expect(
    (await service.message(project.id, 0, '金币改为20分')).messages,
  ).toHaveLength(2);
  expect(attempts).toBe(2);
});
