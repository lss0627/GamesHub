import { planModification } from '@gamerhub/game-planner';
import {
  buildDesignSpec,
  gameCapabilities,
  initialBrief,
  validateBrief,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('modification planning', () => {
  it.each(
    gameCapabilities
      .filter((profile) => profile.runtime)
      .map((profile) => profile.genre),
  )('preserves existing %s scenes on a parameter modification', (genre) => {
    const previousSpec = buildDesignSpec(
      validateBrief({ ...initialBrief, genre }),
    );
    const spec = structuredClone(previousSpec);
    spec.game.name = 'changed title';
    const graph = planModification({
      projectId: 'p',
      runId: 'change',
      specVersionId: 'next',
      changedPaths: ['/game/name'],
      spec,
      previousSpec,
    });
    expect(
      graph.tasks.some((task) => task.capabilities.includes('scene.create')),
    ).toBe(false);
    expect(graph.tasks.some((task) => task.type === 'test')).toBe(true);
    expect(graph.tasks.some((task) => task.type === 'build')).toBe(true);
  });
  it('composes a scene for an explicitly changed genre and still develops added mechanisms in existing scenes', () => {
    const previousSpec = buildDesignSpec(
      validateBrief({ ...initialBrief, genre: 'clicker' }),
    );
    const changed = buildDesignSpec(
      validateBrief({ ...initialBrief, genre: 'flappy' }),
    );
    const changedGraph = planModification({
      projectId: 'p',
      runId: 'genre',
      specVersionId: 'next',
      changedPaths: ['/game/genre'],
      spec: changed,
      previousSpec,
    });
    expect(
      changedGraph.tasks.some((task) =>
        task.capabilities.includes('scene.create'),
      ),
    ).toBe(true);
    const added = buildDesignSpec(
      validateBrief({
        ...initialBrief,
        genre: 'clicker',
        development: [
          {
            id: 'reward',
            description: '新奖励',
            acceptance: ['奖励到账', '暂停拒绝'],
          },
        ],
      }),
    );
    const addedGraph = planModification({
      projectId: 'p',
      runId: 'mechanism',
      specVersionId: 'next',
      changedPaths: ['/extensions'],
      spec: added,
      previousSpec,
    });
    expect(
      addedGraph.tasks.some((task) =>
        task.capabilities.includes('scene.create'),
      ),
    ).toBe(false);
    expect(addedGraph.tasks.some((task) => task.id === 'develop-reward')).toBe(
      true,
    );
  });
  it.each(['runner', 'clicker'] as const)(
    'validates restored %s source without recreating scenes or developing it again',
    (genre) => {
      const spec = buildDesignSpec(
        validateBrief({
          ...initialBrief,
          genre,
          development: [
            {
              id: 'reward',
              description: '领取奖励',
              acceptance: ['奖励到账', '暂停不能领取'],
            },
          ],
        }),
      );
      const graph = planModification({
        projectId: 'p',
        runId: 'restore',
        specVersionId: 'old',
        changedPaths: ['/game'],
        spec,
        restoreSource: true,
      });
      expect(graph.tasks.map((task) => task.type)).toEqual([
        'spec',
        'test',
        'playtest',
        'evaluate',
        'build',
        'publish',
      ]);
      expect(
        graph.tasks.some((task) =>
          task.capabilities.includes('gameplay.develop'),
        ),
      ).toBe(false);
      for (const [index, task] of graph.tasks.entries())
        expect(task.dependencies).toEqual(
          index ? [graph.tasks[index - 1]?.id] : [],
        );
    },
  );
  it('creates a local graph without a full rebuild', () => {
    const graph = planModification({
      projectId: 'project-1',
      runId: 'run-1',
      specVersionId: 'spec-1',
      changedPaths: ['/player/movement/jump_height'],
    });
    expect(graph.tasks.some((task) => task.id === 'scene-create')).toBe(false);
    expect(graph.tasks.some((task) => task.id === 'targeted-playtest')).toBe(
      true,
    );
    expect(graph.tasks.some((task) => task.id === 'build-web')).toBe(true);
  });

  it('plans an asset import task for a player appearance replacement', () => {
    const graph = planModification({
      projectId: 'project-1',
      runId: 'run-asset-1',
      specVersionId: 'spec-1',
      changedPaths: ['/player/appearance/logical_asset_id', '/assets/3'],
    });
    expect(graph.tasks[0]?.id).toBe('asset-import');
    expect(graph.tasks[0]?.type).toBe('asset');
    expect(graph.tasks[0]?.capabilities).toContain('asset.import');
  });
});
