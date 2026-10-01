import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { expect, it, vi } from 'vitest';
import { gameConfigFromSpec } from '../../apps/local-dev/src/real-unity';
import { UnityTaskExecutor } from '../../apps/orchestrator-worker/src/executors/unity-task-executor';

it('carries approved combat and economy numbers into the Unity runtime', () => {
  const arena = buildDesignSpec({
    ...initialBrief,
    genre: 'survivor',
    mechanics: { damage: 3, maxHp: 8, xpPerLevel: 2, enemySpeed: 0.5 },
  });
  expect(gameConfigFromSpec(arena, 'v2')).toMatchObject({
    runtime: 'arena-v1',
    damage: 3,
    maxHp: 8,
    xpPerLevel: 2,
    enemySpeed: 0.5,
    specVersionId: 'v2',
  });
  const clicker = buildDesignSpec({
    ...initialBrief,
    genre: 'clicker',
    coinScore: 25,
    mechanics: { goal: 500, upgradeCost: 50 },
  });
  expect(gameConfigFromSpec(clicker, 'v3')).toMatchObject({
    runtime: 'clicker-v1',
    scorePerCoin: 25,
    goal: 500,
    upgradeCost: 50,
  });
});

it('rejects a successful process that executed zero gameplay assertions', async () => {
  const spec = buildDesignSpec({ ...initialBrief, genre: 'survivor' });
  const task = planGameTaskGraph({
    projectId: 'p',
    runId: 'r',
    gameSpecVersionId: 's',
    spec,
  }).tasks.find((item) => item.type === 'test');
  if (!task) throw new Error('test task missing');
  const adapter = new InMemoryEngineAdapter();
  const original = adapter.runTests.bind(adapter);
  const spy = vi
    .spyOn(adapter, 'runTests')
    .mockImplementation(async (...args) => ({
      ...(await original(...args)),
      passed: 0,
      failed: 0,
    }));
  const executor = new UnityTaskExecutor({
    adapter,
    projectPath: 'project',
    testSuites: [
      { mode: 'playmode', testFilter: 'ArenaPlayModeTests', minimumPassed: 8 },
    ],
  });
  expect((await executor.execute(task, 'r')).status).toBe('failed');
  expect(spy.mock.calls[0]?.[0].testFilter).toBe('ArenaPlayModeTests');
});

it('records clicker time expiry and rejects unimplemented combat options', () => {
  const clicker = buildDesignSpec({ ...initialBrief, genre: 'clicker' });
  expect(clicker.rules.lose_conditions[0]?.type).toBe('time_expired');
  const arena = buildDesignSpec({ ...initialBrief, genre: 'survivor' });
  const combat = arena.systems.find((system) => system.type === 'combat');
  if (!combat) throw new Error('combat required');
  combat.config.projectile_count = 99;
  expect(assessGameCapabilities(arena).executable).toBe(false);
  delete combat.config.projectile_count;
  combat.config.damage = -1;
  expect(assessGameCapabilities(arena).executable).toBe(false);
});

import { planGameTaskGraph } from '../../packages/game-planner/src/planner';
import {
  buildDesignSpec,
  initialBrief,
  validateBrief,
} from '../../packages/game-spec/src/design-document';
import {
  assessGameCapabilities,
  gameCapabilities,
  gameplayProfile,
} from '../../packages/game-spec/src/game-capabilities';

it('keeps legacy drafts and generates real survivor systems instead of Runner', () => {
  expect(validateBrief(initialBrief)).toEqual(initialBrief);
  const brief = validateBrief({
    ...initialBrief,
    genre: 'survivor',
    name: '星灯幸存者',
    mechanics: {
      maxHp: 5,
      damage: 2,
      attackInterval: 0.6,
      enemySpeed: 1,
      enemyHp: 2,
      attackRange: 5,
      xpPerLevel: 3,
    },
  });
  const spec = buildDesignSpec(brief);
  expect(spec.game).toMatchObject({ genre: 'survivor', template: 'arena-v1' });
  expect(spec.player.movement.type).toBe('top_down');
  expect(spec.systems.map((s) => s.type)).toEqual(
    expect.arrayContaining(['combat', 'xp', 'level_up']),
  );
  expect(assessGameCapabilities(spec).executable).toBe(true);
});
it('does not execute design-only genres or unsupported mechanics', () => {
  const spec = buildDesignSpec(
    validateBrief({ ...initialBrief, genre: 'custom' }),
  );
  expect(spec.game.genre).toBe('custom');
  expect(assessGameCapabilities(spec).executable).toBe(false);
  const combat = buildDesignSpec(
    validateBrief({ ...initialBrief, genre: 'survivor' }),
  );
  combat.systems.push({
    system_id: 'dialogue',
    type: 'dialogue',
    enabled: true,
    config: {},
  });
  expect(assessGameCapabilities(combat).gaps.join(' ')).toContain('dialogue');
});
it('plans the selected runtime rather than hardcoded player jumps and coins', () => {
  const spec = buildDesignSpec(
    validateBrief({ ...initialBrief, genre: 'survivor' }),
  );
  const graph = planGameTaskGraph({
    projectId: 'project',
    gameSpecVersionId: 'spec',
    runId: 'run',
    spec,
  });
  expect(graph.tasks.some((t) => t.id === 'runtime-compose')).toBe(true);
  expect(graph.tasks.some((t) => t.id === 'obstacles-create')).toBe(false);
  expect(gameplayProfile(spec).testFilter).toBe('ArenaPlayModeTests');
  expect(gameCapabilities.find((c) => c.genre === 'clicker')?.runtime).toBe(
    'clicker-v1',
  );
});
it('rejects invalid combat parameters rather than silently dropping them', () => {
  expect(() =>
    validateBrief({
      ...initialBrief,
      genre: 'survivor',
      mechanics: { damage: -1 },
    }),
  ).toThrow();
  expect(() =>
    validateBrief({
      ...initialBrief,
      genre: 'survivor',
      mechanics: { arbitraryCode: 'bad' },
    }),
  ).toThrow();
});
