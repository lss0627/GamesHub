import { createHash } from 'node:crypto';
import type { GameSpec } from '@gamerhub/game-spec';
import { type PlannerTask, planGameTaskGraph } from './planner';

export interface ModificationGraph {
  schema_version: '1.0.0';
  graph_id: string;
  project_id: string;
  game_spec_version_id: string;
  run_id: string;
  kind: 'modify';
  tasks: PlannerTask[];
  graph_hash: string;
  impacted_paths: string[];
}

export function planModification(input: {
  projectId: string;
  runId: string;
  specVersionId: string;
  changedPaths: string[];
  spec?: GameSpec;
  previousSpec?: GameSpec;
  rebuild?: boolean;
  restoreSource?: boolean;
}): ModificationGraph {
  if (input.spec) {
    const base = planGameTaskGraph({
      projectId: input.projectId,
      runId: input.runId,
      gameSpecVersionId: input.specVersionId,
      spec: input.spec,
      ...(input.previousSpec ? { previousSpec: input.previousSpec } : {}),
    });
    const preserveScene =
      input.restoreSource ||
      (!input.rebuild &&
        input.previousSpec?.game.genre === input.spec.game.genre);
    const graph = {
      ...base,
      ...(preserveScene
        ? {
            tasks: base.tasks
              .filter(
                (task) =>
                  [
                    'spec',
                    'test',
                    'playtest',
                    'evaluate',
                    'build',
                    'publish',
                  ].includes(task.type) ||
                  (!input.restoreSource &&
                    (task.type === 'asset' ||
                      task.capabilities.includes('gameplay.develop'))),
              )
              .map((task, index, tasks) => ({
                ...task,
                dependencies: index ? [tasks[index - 1]?.id ?? 'invalid'] : [],
              })),
          }
        : {}),
      kind: 'modify' as const,
      impacted_paths: [...input.changedPaths],
    };
    return {
      ...graph,
      graph_hash: `sha256-${createHash('sha256').update(JSON.stringify(graph)).digest('hex')}`,
    };
  }
  const assetChange = input.changedPaths.some(
    (path) =>
      path.includes('/player/appearance/logical_asset_id') ||
      path.startsWith('/assets/') ||
      path.includes('/asset'),
  );
  const definitions: Array<
    Pick<
      PlannerTask,
      | 'id'
      | 'type'
      | 'description'
      | 'validation_method'
      | 'related_files'
      | 'related_scenes'
      | 'capabilities'
    >
  > = [
    assetChange
      ? {
          id: 'asset-import',
          type: 'asset',
          description: 'Import and validate the replacement character asset',
          validation_method: {
            type: 'playtest_assertion',
            reference: 'AssetImportTests.StableLogicalMapping',
          },
          related_files: ['Assets/Game/Art/Player.png'],
          related_scenes: ['runner_scene'],
          capabilities: ['asset.import', 'component.set_property'],
        }
      : {
          id: 'parameter-update',
          type: 'component',
          description: 'Update the declared gameplay parameter',
          validation_method: {
            type: 'compile',
            reference: 'GameplayParameterCommands',
          },
          related_files: ['Assets/Game/Scripts/PlayerController.cs'],
          related_scenes: ['runner_scene'],
          capabilities: ['component.set_property'],
        },
    {
      id: 'targeted-playtest',
      type: 'playtest',
      description: 'Run impacted assertions and smoke checks',
      validation_method: {
        type: 'playtest_assertion',
        reference: 'impacted-assertions',
      },
      related_files: [],
      related_scenes: ['runner_scene'],
      capabilities: ['play.input', 'play.state'],
    },
    {
      id: 'targeted-evaluate',
      type: 'evaluate',
      description: 'Evaluate targeted evidence',
      validation_method: {
        type: 'playtest_assertion',
        reference: 'EvaluationReport@1.0.0',
      },
      related_files: [],
      related_scenes: [],
      capabilities: ['evaluation.run'],
    },
    {
      id: 'build-web',
      type: 'build',
      description: 'Build a new immutable preview',
      validation_method: { type: 'web_smoke', reference: 'WebBuildSmoke' },
      related_files: ['Builds/Web'],
      related_scenes: [],
      capabilities: ['build.web'],
    },
    {
      id: 'publish-preview',
      type: 'publish',
      description: 'Publish the updated preview',
      validation_method: { type: 'web_smoke', reference: 'PreviewLoadSmoke' },
      related_files: [],
      related_scenes: [],
      capabilities: ['preview.publish'],
    },
  ];
  const tasks = definitions.map((definition, index) => ({
    ...definition,
    dependencies:
      index === 0 ? [] : [definitions[index - 1]?.id ?? 'invalid-dependency'],
    status: 'pending' as const,
    retry_count: 0,
    max_retries: 2,
  }));
  const graph = {
    schema_version: '1.0.0' as const,
    graph_id: `modify-${input.runId}`,
    project_id: input.projectId,
    game_spec_version_id: input.specVersionId,
    run_id: input.runId,
    kind: 'modify' as const,
    tasks,
    impacted_paths: [...input.changedPaths],
  };
  return {
    ...graph,
    graph_hash: `sha256-${createHash('sha256').update(JSON.stringify(graph)).digest('hex')}`,
  };
}
