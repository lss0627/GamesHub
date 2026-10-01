import { expect, it } from 'vitest';
import { gameConfigFromSpec } from '../../apps/local-dev/src/real-unity';
import { planGameTaskGraph } from '../../packages/game-planner/src/planner';
import {
  assessGameCapabilities,
  buildDesignSpec,
  gameCapabilities,
  initialBrief,
} from '../../packages/game-spec/src';

it.each(gameCapabilities.filter((p) => p.runtime))(
  '$genre has a mapped runtime, rules and a unique verification gate',
  (profile) => {
    const spec = buildDesignSpec({ ...initialBrief, genre: profile.genre });
    const result = assessGameCapabilities(spec);
    expect(result.gaps).toEqual([]);
    expect(result.status).toBe('ready');
    expect(gameConfigFromSpec(spec, 'approved')).toMatchObject({
      runtime: profile.runtime,
      genre: profile.genre,
    });
    const graph = planGameTaskGraph({
      projectId: 'project',
      gameSpecVersionId: 'approved',
      runId: 'run',
      spec,
    });
    expect(graph.tasks.some((t) => t.id === 'unity-tests')).toBe(true);
    expect(graph.tasks).toHaveLength(7);
    expect(graph.tasks.filter((t) => t.type === 'scene')).toMatchObject([
      { id: 'runtime-compose', capabilities: ['scene.create'] },
    ]);
    expect(graph.tasks.flatMap((t) => t.capabilities)).not.toContain(
      'prefab.create',
    );
    spec.rules.win_conditions.push({
      condition_id: 'invented_win',
      type: 'score_at_least',
      parameters: { score: 999999 },
    });
    expect(assessGameCapabilities(spec).executable).toBe(false);
  },
);
it('maps platform jump and tower combat while rejecting nonexistent tower targeting controls', () => {
  const platform = buildDesignSpec({
    ...initialBrief,
    genre: 'platformer',
    jump: 9,
  });
  expect(gameConfigFromSpec(platform, 'jump').jumpVelocity).toBe(9);
  const tower = buildDesignSpec({
    ...initialBrief,
    genre: 'tower_defense',
    mechanics: { damage: 7, enemyHp: 8, enemySpeed: 2, attackInterval: 1.2 },
  });
  expect(gameConfigFromSpec(tower, 'tower')).toMatchObject({
    damage: 7,
    enemyHp: 8,
    enemySpeed: 2,
    attackInterval: 1.2,
  });
  const combat = tower.systems.find((s) => s.type === 'combat');
  if (!combat) throw new Error('combat required');
  combat.config.range = 8;
  expect(assessGameCapabilities(tower).gaps).not.toEqual([]);
});
it('preserves legacy three-option progression and enables approved fourth upgrade', () => {
  const spec = buildDesignSpec({ ...initialBrief, genre: 'survivor' });
  expect(gameConfigFromSpec(spec, 'four')).toMatchObject({
    upgradeChoicesCount: 4,
  });
  const upgrades = spec.systems.find((s) => s.type === 'level_up');
  if (!upgrades) throw new Error('upgrades required');
  upgrades.config.choices = ['damage', 'speed', 'heal'];
  expect(gameConfigFromSpec(spec, 'legacy')).toMatchObject({
    upgradeChoicesCount: 3,
  });
});

it('rejects preset combinations that make the fixed course impossible', () => {
  const flappy = buildDesignSpec({
    ...initialBrief,
    genre: 'flappy',
    duration: 30,
    speed: 3,
    interval: 4,
  });
  expect(assessGameCapabilities(flappy).gaps.join(' ')).toContain('8道门');
  const platform = buildDesignSpec({
    ...initialBrief,
    genre: 'platformer',
    speed: 3,
    jump: 6,
  });
  expect(assessGameCapabilities(platform).gaps.join(' ')).toContain('深坑');
  expect(
    assessGameCapabilities(
      buildDesignSpec({
        ...initialBrief,
        genre: 'platformer',
        speed: 3,
        jump: 10,
      }),
    ).executable,
  ).toBe(true);
});
