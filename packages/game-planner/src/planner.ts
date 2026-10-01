import { createHash } from 'node:crypto';
import { parseTaskGraph } from '@gamerhub/contracts';
import {
  developmentFor,
  type GameSpec,
  gameplayProfile,
  type MechanismDevelopment,
} from '@gamerhub/game-spec';

export interface PlannerTask {
  id: string;
  type:
    | 'spec'
    | 'scene'
    | 'component'
    | 'script'
    | 'asset'
    | 'test'
    | 'playtest'
    | 'evaluate'
    | 'fix'
    | 'build'
    | 'publish'
    | 'rollback';
  description: string;
  dependencies: string[];
  status:
    | 'pending'
    | 'running'
    | 'blocked'
    | 'failed'
    | 'completed'
    | 'cancelled';
  retry_count: number;
  max_retries: number;
  validation_method: {
    type:
      | 'schema'
      | 'compile'
      | 'editmode_test'
      | 'playmode_test'
      | 'playtest_assertion'
      | 'web_smoke'
      | 'manual_gate';
    reference: string;
    criteria?: DevelopmentCriterion[];
  };
  related_files: string[];
  related_scenes: string[];
  capabilities: string[];
}

export interface DevelopmentCriterion {
  id: string;
  description: string;
  testPrefix: string;
}
export function developmentAcceptance(
  item: MechanismDevelopment,
): DevelopmentCriterion[] | undefined {
  if (item.acceptanceVersion !== 1) return undefined;
  return item.acceptance.map((description, index) => {
    const number = String(index + 1).padStart(2, '0');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          item.id,
          item.operation ?? 'implement',
          item.description,
          description,
        ]),
      )
      .digest('hex')
      .slice(0, 12);
    return {
      id: `${item.id}.${number}`,
      description,
      testPrefix: `Acceptance_${number}_${fingerprint}`,
    };
  });
}

export interface PlannedTaskGraph {
  schema_version: '1.0.0';
  graph_id: string;
  project_id: string;
  game_spec_version_id: string;
  run_id: string;
  kind: 'create' | 'modify' | 'fix' | 'rollback' | 'validate' | 'publish';
  tasks: PlannerTask[];
  graph_hash: string;
}

function graphHash(graph: Omit<PlannedTaskGraph, 'graph_hash'>): string {
  return `sha256-${createHash('sha256').update(JSON.stringify(graph)).digest('hex')}`;
}

export function planRunnerTaskGraph(input: {
  projectId: string;
  gameSpecVersionId: string;
  runId: string;
  spec: GameSpec;
}): PlannedTaskGraph {
  void input.spec;
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
    {
      id: 'spec-validate',
      type: 'spec',
      description: 'Validate the engine-neutral Game Spec',
      validation_method: { type: 'schema', reference: 'gameSpecSchema@1.0.0' },
      related_files: ['GameSpec.json'],
      related_scenes: [],
      capabilities: ['spec.validate'],
    },
    {
      id: 'scene-create',
      type: 'scene',
      description: 'Create the curated Runner scene',
      validation_method: { type: 'compile', reference: 'RunnerSceneExists' },
      related_files: ['Assets/Game/Scenes/Runner.unity'],
      related_scenes: ['runner_scene'],
      capabilities: ['scene.create'],
    },
    {
      id: 'player-create',
      type: 'component',
      description: 'Create player movement and jump behavior',
      validation_method: {
        type: 'editmode_test',
        reference: 'RunnerEditModeTests.PlayerConfiguration',
      },
      related_files: ['Assets/Game/Scripts/PlayerController.cs'],
      related_scenes: ['runner_scene'],
      capabilities: [
        'game_object.create',
        'component.set_property',
        'script.create',
      ],
    },
    {
      id: 'obstacles-create',
      type: 'component',
      description: 'Create obstacle collision behavior',
      validation_method: {
        type: 'editmode_test',
        reference: 'RunnerEditModeTests.ObstacleConfiguration',
      },
      related_files: ['Assets/Game/Scripts/Obstacle.cs'],
      related_scenes: ['runner_scene'],
      capabilities: ['prefab.create', 'component.set_property'],
    },
    {
      id: 'coins-create',
      type: 'component',
      description: 'Create coin pickup and score behavior',
      validation_method: {
        type: 'playmode_test',
        reference: 'RunnerPlayModeTests.CoinPickupAddsScore',
      },
      related_files: ['Assets/Game/Scripts/Coin.cs'],
      related_scenes: ['runner_scene'],
      capabilities: ['prefab.create', 'script.create'],
    },
    {
      id: 'game-over-create',
      type: 'script',
      description: 'Create game-over, restart and HUD behavior',
      validation_method: {
        type: 'playmode_test',
        reference: 'RunnerPlayModeTests.RestartAfterGameOver',
      },
      related_files: [
        'Assets/Game/Scripts/RunnerGameManager.cs',
        'Assets/Game/Scripts/RunnerHud.cs',
      ],
      related_scenes: ['runner_scene'],
      capabilities: ['script.create', 'ui.create'],
    },
    {
      id: 'unity-tests',
      type: 'test',
      description: 'Run EditMode and PlayMode checks',
      validation_method: {
        type: 'playmode_test',
        reference: 'RunnerEditModeTests;RunnerPlayModeTests',
      },
      related_files: ['Assets/Tests'],
      related_scenes: ['runner_scene'],
      capabilities: ['test.editmode', 'test.playmode'],
    },
    {
      id: 'playtest-run',
      type: 'playtest',
      description: 'Run deterministic probe assertions',
      validation_method: {
        type: 'playtest_assertion',
        reference: 'runnerGameSpec.verification',
      },
      related_files: [],
      related_scenes: ['runner_scene'],
      capabilities: ['play.input', 'play.state', 'collision.observe'],
    },
    {
      id: 'evaluate-runner',
      type: 'evaluate',
      description: 'Evaluate evidence against the Game Spec',
      validation_method: {
        type: 'playtest_assertion',
        reference: 'EvaluationReport@1.0.0',
      },
      related_files: [],
      related_scenes: ['runner_scene'],
      capabilities: ['evaluation.run'],
    },
    {
      id: 'build-web',
      type: 'build',
      description: 'Build the pinned Unity Web profile',
      validation_method: { type: 'web_smoke', reference: 'WebBuildSmoke' },
      related_files: ['Builds/Web'],
      related_scenes: ['runner_scene'],
      capabilities: ['build.web'],
    },
    {
      id: 'publish-preview',
      type: 'publish',
      description: 'Publish an immutable playable preview',
      validation_method: { type: 'web_smoke', reference: 'PreviewLoadSmoke' },
      related_files: [],
      related_scenes: [],
      capabilities: ['preview.publish'],
    },
  ];
  const tasks: PlannerTask[] = definitions.map((definition, index) => ({
    ...definition,
    dependencies:
      index === 0 ? [] : [definitions[index - 1]?.id ?? 'invalid-dependency'],
    status: 'pending',
    retry_count: 0,
    max_retries: 2,
  }));
  const withoutHash = {
    schema_version: '1.0.0' as const,
    graph_id: `graph-${input.runId}`,
    project_id: input.projectId,
    game_spec_version_id: input.gameSpecVersionId,
    run_id: input.runId,
    kind: 'create' as const,
    tasks,
  };
  return { ...withoutHash, graph_hash: graphHash(withoutHash) };
}

/** Runtime selection is explicit; Runner remains a compatibility profile. */
export function planGameTaskGraph(
  input: Parameters<typeof planRunnerTaskGraph>[0] & {
    previousSpec?: GameSpec;
  },
): PlannedTaskGraph {
  const profile = gameplayProfile(input.spec);
  const base = planRunnerTaskGraph(input);
  const ids = new Set([
    'spec-validate',
    'scene-create',
    'unity-tests',
    'playtest-run',
    'evaluate-runner',
    'build-web',
    'publish-preview',
  ]);
  const tasks = base.tasks
    .filter((task) => ids.has(task.id))
    .map((task) => ({ ...task, related_scenes: [input.spec.level.scene_id] }));
  for (const [index, task] of tasks.entries()) {
    if (task.id === 'scene-create') {
      task.id = 'runtime-compose';
      task.description = `组装${profile.name}：${input.spec.systems
        .filter((s) => s.enabled)
        .map((s) => s.type)
        .join('、')}`;
      task.validation_method.reference = profile.runtime;
    }
    if (task.type === 'test' || task.type === 'playtest') {
      task.description = `验证${profile.name}玩法：${profile.loop}`;
      task.validation_method.reference = profile.testFilter;
    }
    if (task.type === 'evaluate') {
      task.id = 'evaluate-game';
      task.description = `检查${profile.name}的实际玩法证据`;
    }
    task.dependencies = index === 0 ? [] : [tasks[index - 1]?.id ?? 'invalid'];
  }
  const previousDevelopment = new Map(
    (input.previousSpec &&
    input.previousSpec.game.genre === input.spec.game.genre
      ? developmentFor(input.previousSpec)
      : []
    ).map((item) => [item.id, JSON.stringify(item)]),
  );
  const development = developmentFor(input.spec).filter(
    (item) => previousDevelopment.get(item.id) !== JSON.stringify(item),
  );
  const entryFiles = (
    profile.runtime === 'runner-v1'
      ? [
          'RunnerGameManager.cs',
          'PlayerController.cs',
          'RunnerSceneBootstrap.cs',
        ]
      : profile.runtime === 'arena-v1'
        ? ['ArenaGame.cs', 'ArenaSimulation.cs']
        : profile.runtime === 'clicker-v1'
          ? ['ClickerGame.cs', 'ClickerSimulation.cs']
          : ['ArcadeGame.cs', 'ArcadeSimulations.cs']
  ).map((file) => `Assets/Game/Scripts/${file}`);
  const validationIndex = tasks.findIndex((task) => task.id === 'unity-tests');
  tasks.splice(
    validationIndex,
    0,
    ...development.map((item) => ({
      id: `develop-${item.id}`,
      type: 'script' as const,
      description: `${item.operation === 'retire' ? '机制退役：移除该机制的入口、挂载和实际效果；保留其他玩法，负向测试证明旧机制不能再触发。\n' : ''}${item.description}\n当前玩法入口：${entryFiles.join('、')}。优先读取这些文件。\n行为验收：\n${item.acceptance.map((text, i) => `${i + 1}. ${text}`).join('\n')}\n${
        developmentAcceptance(item)
          ?.map(
            (criterion) =>
              `测试方法必须以${criterion.testPrefix}开头，对应${criterion.id}。`,
          )
          .join('\n') ?? '至少两项真实行为测试。'
      }\n测试必须驱动实际实现，保留其他已确认玩法。`,
      dependencies: [],
      status: 'pending' as const,
      retry_count: 0,
      max_retries: 2,
      validation_method: {
        type: 'playmode_test' as const,
        reference: `GamerHub.Generated.${item.id}Tests`,
        ...(developmentAcceptance(item)
          ? { criteria: developmentAcceptance(item) ?? [] }
          : {}),
      },
      related_files: [
        ...entryFiles,
        `Assets/Game/Scripts/Generated/${item.id}.cs`,
        `Assets/Tests/PlayMode/Generated/${item.id}Tests.cs`,
      ],
      related_scenes: [input.spec.level.scene_id],
      capabilities: ['gameplay.develop', 'script.create', 'test.playmode'],
    })),
  );
  for (const [index, task] of tasks.entries())
    task.dependencies = index ? [tasks[index - 1]?.id ?? 'invalid'] : [];
  const { graph_hash: _previousHash, ...graph } = { ...base, tasks };
  return { ...graph, graph_hash: graphHash(graph) };
}

export function validateTaskGraph(graph: PlannedTaskGraph): true {
  const taskIds = new Set(graph.tasks.map((task) => task.id));
  for (const task of graph.tasks)
    for (const dependency of task.dependencies)
      if (!taskIds.has(dependency))
        throw new Error(`UNKNOWN_DEPENDENCY: ${dependency}`);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`TASK_GRAPH_CYCLE: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const task = graph.tasks.find((candidate) => candidate.id === id);
    for (const dependency of task?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of graph.tasks) visit(task.id);
  parseTaskGraph({
    schema_version: graph.schema_version,
    graph_id: graph.graph_id,
    project_id: graph.project_id,
    game_spec_version_id: graph.game_spec_version_id,
    kind: graph.kind,
    tasks: graph.tasks,
  });
  return true;
}

export function readyTasks(graph: PlannedTaskGraph): PlannerTask[] {
  const completed = new Set(
    graph.tasks
      .filter((task) => task.status === 'completed')
      .map((task) => task.id),
  );
  return graph.tasks.filter(
    (task) =>
      task.status === 'pending' &&
      task.dependencies.every((dependency) => completed.has(dependency)),
  );
}
