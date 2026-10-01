import { planRunnerTaskGraph, validateTaskGraph } from '@gamerhub/game-planner';
import { runnerGameSpec } from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('Game Spec planner', () => {
  it('creates an acyclic graph with validation mapping for every task', () => {
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      gameSpecVersionId: 'spec-1',
      runId: 'run-1',
      spec: runnerGameSpec,
    });
    expect(validateTaskGraph(graph)).toBe(true);
    expect(graph.tasks.length).toBeGreaterThan(5);
    for (const task of graph.tasks)
      expect(task.validation_method.reference.length).toBeGreaterThan(0);
  });

  it('does not allow dependency cycles', () => {
    const graph = planRunnerTaskGraph({
      projectId: 'project-1',
      gameSpecVersionId: 'spec-1',
      runId: 'run-1',
      spec: runnerGameSpec,
    });
    const first = graph.tasks[0];
    if (!first) throw new Error('expected planner tasks');
    expect(() =>
      validateTaskGraph({
        ...graph,
        tasks: graph.tasks.map((task) =>
          task.id === first.id
            ? {
                ...task,
                dependencies: [
                  ...task.dependencies,
                  ...(graph.tasks.at(-1) ? [graph.tasks.at(-1)?.id ?? ''] : []),
                ],
              }
            : task,
        ),
      }),
    ).toThrow(/cycle/i);
  });
});
