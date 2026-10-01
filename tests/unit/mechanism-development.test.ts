import { parseTaskGraph } from '@gamerhub/contracts';
import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { expect, it, vi } from 'vitest';
import { UnityTaskExecutor } from '../../apps/orchestrator-worker/src/executors/unity-task-executor';
import { planModification } from '../../packages/game-planner/src/modification-planner';
import { planGameTaskGraph } from '../../packages/game-planner/src/planner';
import {
  buildDesignSpec,
  initialBrief,
  validateBrief,
} from '../../packages/game-spec/src/design-document';
import { gameplayTestSuites } from '../../packages/game-spec/src/game-capabilities';

function developmentTask() {
  const brief = validateBrief({
    ...initialBrief,
    genre: 'survivor',
    development: [
      {
        id: 'dash',
        description: '按 Shift 冲刺，冷却期间不可重复',
        acceptance: ['冲刺移动距离大于正常走路', '冷却期间再次输入不生效'],
      },
    ],
  });
  const spec = buildDesignSpec(brief);
  const graph = planGameTaskGraph({
    projectId: 'p',
    runId: 'r',
    gameSpecVersionId: 's',
    spec,
  });
  const task = graph.tasks.find((t) =>
    t.capabilities.includes('gameplay.develop'),
  );
  if (!task) throw new Error('DEVELOPMENT_TASK_MISSING');
  return { task, graph };
}
it('plans declared development before full gameplay validation with acceptance and exact test filter', () => {
  const { task, graph } = developmentTask();
  expect(task.description).toContain('冷却期间');
  expect(task.validation_method.reference).toBe('GamerHub.Generated.dashTests');
  expect(
    graph.tasks.find((t) => t.id === 'unity-tests')?.dependencies,
  ).toContain(task.id);
});

it('binds new acceptance to indexed case prefixes that change when the requested behavior changes', () => {
  const first = developmentTask();
  const criteria = first.task.validation_method.criteria;
  expect(criteria).toHaveLength(2);
  expect(criteria?.[0]).toMatchObject({
    id: 'dash.01',
    description: '冲刺移动距离大于正常走路',
    testPrefix: expect.stringMatching(/^Acceptance_01_[a-f0-9]{12}$/),
  });
  const spec = buildDesignSpec(
    validateBrief({
      ...initialBrief,
      genre: 'survivor',
      development: [
        {
          id: 'dash',
          description: '更远的冲刺',
          acceptance: ['冲刺移动距离大于正常走路', '冷却期间再次输入不生效'],
        },
      ],
    }),
  );
  const next = planGameTaskGraph({
    projectId: 'p',
    runId: 'r2',
    gameSpecVersionId: 's2',
    spec,
  }).tasks.find((task) => task.id === 'develop-dash');
  expect(next?.validation_method.criteria?.[0]?.testPrefix).not.toBe(
    criteria?.[0]?.testPrefix,
  );
  const { graph_hash: _hash, run_id: _run, ...contract } = first.graph;
  expect(
    parseTaskGraph({
      ...contract,
      project_id: 'project',
      game_spec_version_id: 'spec',
    }).tasks.find((task) => task.id === 'develop-dash')?.validation_method
      .criteria,
  ).toEqual(criteria);
});

it('blocks count-only or stale criterion evidence even when the total number of tests passes', async () => {
  const { task } = developmentTask();
  const adapter = new InMemoryEngineAdapter();
  const original = adapter.runTests.bind(adapter);
  vi.spyOn(adapter, 'runTests').mockImplementation(async (...args) => ({
    ...(await original(...args)),
    passed: 20,
    failed: 0,
    output: {
      testCases: [
        {
          fullName:
            'GamerHub.Generated.dashTests.Acceptance_01_old_requirement',
          result: 'Passed',
        },
      ],
      testReport: { contentHash: `sha256-${'a'.repeat(64)}` },
    },
  }));
  const result = await new UnityTaskExecutor({
    adapter,
    projectPath: 'project',
  }).execute(task, 'r');
  expect(result.status).toBe('failed');
  expect(result.error?.code).toBe('DEVELOPMENT_ACCEPTANCE_REQUIRED');
  expect(result.error?.message).toContain('dash.01');
});

it('accepts only passed current criterion cases with a report hash', async () => {
  const { task } = developmentTask();
  const adapter = new InMemoryEngineAdapter();
  const original = adapter.runTests.bind(adapter);
  vi.spyOn(adapter, 'runTests').mockImplementation(async (...args) => ({
    ...(await original(...args)),
    passed: 2,
    failed: 0,
    output: {
      testCases: task.validation_method.criteria?.map((criterion) => ({
        fullName: `GamerHub.Generated.dashTests.${criterion.testPrefix}_Behavior`,
        result: 'Passed',
      })),
      testReport: { contentHash: `sha256-${'b'.repeat(64)}` },
    },
  }));
  const result = await new UnityTaskExecutor({
    adapter,
    projectPath: 'project',
  }).execute(task, 'r');
  expect(result.status).toBe('completed');
  expect(result.verification?.[0]?.criteria).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'dash.01', status: 'passed' }),
    ]),
  );
});

it('keeps explicit retirement requirements and rejects silent removal of existing mechanisms', () => {
  const current = buildDesignSpec(
    validateBrief({
      ...initialBrief,
      genre: 'clicker',
      development: [
        {
          id: 'reward',
          description: '领取奖励',
          acceptance: ['奖励到账', '暂停拒绝'],
        },
      ],
    }),
  );
  expect(() =>
    buildDesignSpec(
      validateBrief({ ...initialBrief, genre: 'clicker', development: [] }),
      current,
    ),
  ).toThrow('DEVELOPMENT_REMOVAL_REQUIRES_PLAN');
  const retired = buildDesignSpec(
    validateBrief({
      ...initialBrief,
      genre: 'clicker',
      development: [
        {
          id: 'reward',
          operation: 'retire',
          description: '移除奖励领取入口和效果',
          acceptance: ['旧按钮和按键不再发放奖励', '普通点击收益保持不变'],
        },
      ],
    }),
    current,
  );
  expect(retired.extensions?.gamerhub_development).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'reward', operation: 'retire' }),
    ]),
  );
  const graph = planModification({
    projectId: 'p',
    runId: 'retire',
    specVersionId: 's2',
    changedPaths: ['/extensions'],
    spec: retired,
    previousSpec: current,
  });
  expect(
    graph.tasks.find((task) => task.id === 'develop-reward')?.description,
  ).toContain('退役');
  expect(
    gameplayTestSuites(retired).some(
      (suite) => suite.testFilter === 'GamerHub.Generated.rewardTests',
    ),
  ).toBe(true);
});

it.each(['Skipped', 'Inconclusive', 'Failed'])(
  'blocks a %s criterion during full regression',
  async (status) => {
    const { task, graph } = developmentTask();
    const adapter = new InMemoryEngineAdapter();
    const original = adapter.runTests.bind(adapter);
    vi.spyOn(adapter, 'runTests').mockImplementation(async (...args) => ({
      ...(await original(...args)),
      passed: 20,
      failed: 0,
      output: {
        testCases: task.validation_method.criteria?.map((criterion, index) => ({
          fullName: `${task.validation_method.reference}.${criterion.testPrefix}_Check`,
          result: index === 0 ? status : 'Passed',
        })),
        testReport: { contentHash: `sha256-${'c'.repeat(64)}` },
      },
    }));
    const result = await new UnityTaskExecutor({
      adapter,
      projectPath: 'project',
      testSuites: [
        {
          mode: 'playmode',
          testFilter: task.validation_method.reference,
          minimumPassed: 2,
          criteria: task.validation_method.criteria ?? [],
        },
      ],
    }).execute(graph.tasks.find((entry) => entry.type === 'test') ?? task, 'r');
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('DEVELOPMENT_ACCEPTANCE_REQUIRED');
  },
);
it('does not claim a development task completed when its behavior tests are missing', async () => {
  const { task } = developmentTask();
  const adapter = new InMemoryEngineAdapter();
  const original = adapter.runTests.bind(adapter);
  vi.spyOn(adapter, 'runTests').mockImplementation(async (...args) => ({
    ...(await original(...args)),
    passed: 0,
    failed: 0,
  }));
  const result = await new UnityTaskExecutor({
    adapter,
    projectPath: 'project',
  }).execute(task, 'r');
  expect(result.status).toBe('failed');
  expect(adapter.runTests).toHaveBeenCalledWith(
    expect.objectContaining({ testFilter: 'GamerHub.Generated.dashTests' }),
    expect.anything(),
  );
});
it('rejects unsafe development IDs and empty behavioral acceptance', () => {
  expect(() =>
    validateBrief({
      ...initialBrief,
      development: [{ id: '../escape', description: 'bad', acceptance: [] }],
    }),
  ).toThrow();
});

it('preserves unchanged mechanisms during parameter edits but always includes their behavior gate', () => {
  const previousSpec = buildDesignSpec({
    ...initialBrief,
    genre: 'clicker',
    development: [
      {
        id: 'reward',
        description: '领取20点奖励，冷却3秒',
        acceptance: ['每次仅增加20', '冷却期间不能重复领取'],
      },
    ],
  });
  const spec = buildDesignSpec(
    { ...initialBrief, genre: 'clicker', coinScore: 15 },
    previousSpec,
  );
  const graph = planModification({
    projectId: 'p',
    runId: 'r',
    specVersionId: 's',
    changedPaths: ['/systems/score/config/per_click'],
    spec,
    previousSpec,
  });
  expect(
    graph.tasks.some((t) => t.capabilities.includes('gameplay.develop')),
  ).toBe(false);
  expect(graph.tasks.some((t) => t.id === 'unity-tests')).toBe(true);
  expect(gameplayTestSuites(spec)).toContainEqual({
    mode: 'playmode',
    testFilter: 'GamerHub.Generated.rewardTests',
    minimumPassed: 2,
  });
  const changed = buildDesignSpec(
    {
      ...initialBrief,
      genre: 'clicker',
      development: [
        {
          id: 'reward',
          description: '领取30点奖励，冷却3秒',
          acceptance: ['每次仅增加30', '冷却期间不能重复领取'],
        },
      ],
    },
    previousSpec,
  );
  expect(
    planModification({
      projectId: 'p',
      runId: 'r',
      specVersionId: 's',
      changedPaths: ['/extensions/gamerhub_development'],
      spec: changed,
      previousSpec,
    }).tasks.some((t) => t.id === 'develop-reward'),
  ).toBe(true);
});
