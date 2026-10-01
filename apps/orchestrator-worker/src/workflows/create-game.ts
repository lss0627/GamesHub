import { createHash } from 'node:crypto';
import { type PlannerTask, planGameTaskGraph } from '@gamerhub/game-planner';
import {
  type GameSpec,
  GameSpecService,
  type GameSpecVersionRecord,
  hashGameSpec,
  interpretRunnerPrompt,
  type RequirementInterpreter,
  runnerGameSpec,
} from '@gamerhub/game-spec';
import { TaskGraphRunner } from './task-graph-runner';

export interface CreateGameEvidence {
  type: string;
  reference: string;
  contentHash?: string;
}

export interface TestVerification {
  suite: string;
  mode: 'indexed' | 'legacy' | 'baseline';
  passed: number;
  failed: number;
  reportHash?: string;
  criteria: Array<{
    id: string;
    description: string;
    status: 'passed' | 'failed' | 'missing';
    caseCount: number;
  }>;
}

export interface CreateGameTaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  evidence: CreateGameEvidence[];
  verification?: TestVerification[];
  changedArtifacts?: string[];
  projectRevision?: string;
  durablePlaytestRunId?: string;
  error?: { code: string; message: string; retryable?: boolean };
}

export interface PreviewPublication {
  healthy: boolean;
  url: string;
  buildHash?: string;
  previewId?: string;
  evidence?: CreateGameEvidence[];
  browser?: {
    passed: boolean;
    runId: string;
    specVersionId: string;
    buildHash: string;
    reportHash: string;
    checks: Array<{
      id: string;
      status: 'passed' | 'failed';
      durationMs: number;
    }>;
  };
}

export interface EvidenceGateResult {
  passed: boolean;
  checkedTaskIds: string[];
  missingTaskEvidence: string[];
  requiredEvidenceTypes: string[];
  missingEvidenceTypes: string[];
}

export interface CreateGameWorkflowResult {
  graphId: string;
  status: 'succeeded' | 'failed';
  completedTaskIds: string[];
  previewUrl?: string;
  specVersionId?: string;
  evidenceGate: EvidenceGateResult;
  failureCode?: string;
  failureMessage?: string;
  evidence: CreateGameEvidence[];
}

export interface CreateGameWorkflowInput {
  projectId: string;
  runId: string;
  spec?: GameSpec;
  executeTask?: (task: PlannerTask) => Promise<CreateGameTaskResult>;
  publishPreview?: (input: {
    projectId: string;
    runId: string;
    buildHash: string;
    evidence: CreateGameEvidence[];
  }) => Promise<PreviewPublication>;
  onProgress?: (input: {
    task: PlannerTask;
    result: CreateGameTaskResult;
    totalTasks: number;
  }) => Promise<void> | void;
  specService?: GameSpecService;
  specVersionId?: string;
  signal?: AbortSignal;
}

const requiredEvidenceTypes = [
  'schema',
  'engine',
  'test',
  'playtest',
  'evaluation',
  'build',
  'preview',
];

function failedGate(
  checkedTaskIds: string[] = [],
  missingTaskEvidence: string[] = [],
  missingTypes = requiredEvidenceTypes,
): EvidenceGateResult {
  return {
    passed: false,
    checkedTaskIds,
    missingTaskEvidence,
    requiredEvidenceTypes: [...requiredEvidenceTypes],
    missingEvidenceTypes: [...missingTypes],
  };
}

function gateEvidence(
  graphTasks: PlannerTask[],
  results: CreateGameTaskResult[],
  publication?: PreviewPublication,
): EvidenceGateResult {
  const resultByTask = new Map(
    results.map((result) => [result.taskId, result]),
  );
  const checkedTaskIds = graphTasks.map((task) => task.id);
  const missingTaskEvidence = graphTasks
    .filter((task) => {
      const result = resultByTask.get(task.id);
      return result?.status !== 'completed' || result.evidence.length === 0;
    })
    .map((task) => task.id);
  const evidence = results.flatMap((result) => result.evidence);
  if (publication?.healthy)
    evidence.push(
      ...(publication.evidence ?? [
        { type: 'preview', reference: publication.url },
      ]),
    );
  const observedTypes = new Set(
    evidence.map((item) => item.type.toLowerCase()),
  );
  const missingEvidenceTypes = requiredEvidenceTypes.filter(
    (type) => !observedTypes.has(type),
  );
  return {
    passed:
      missingTaskEvidence.length === 0 &&
      missingEvidenceTypes.length === 0 &&
      Boolean(publication?.healthy),
    checkedTaskIds,
    missingTaskEvidence,
    requiredEvidenceTypes: [...requiredEvidenceTypes],
    missingEvidenceTypes,
  };
}

function failureResult(
  graphId: string,
  gate: EvidenceGateResult,
  completedTaskIds: string[],
  evidence: CreateGameEvidence[],
  failureCode: string,
  failureMessage: string,
  specVersionId?: string,
): CreateGameWorkflowResult {
  return {
    graphId,
    status: 'failed',
    completedTaskIds,
    evidenceGate: gate,
    evidence,
    failureCode,
    failureMessage,
    ...(specVersionId ? { specVersionId } : {}),
  };
}

export async function createGameWorkflow(
  input: CreateGameWorkflowInput,
): Promise<CreateGameWorkflowResult> {
  const graph = planGameTaskGraph({
    projectId: input.projectId,
    gameSpecVersionId: input.specVersionId ?? `spec-${input.runId}`,
    runId: input.runId,
    spec: input.spec ?? runnerGameSpec,
  });
  const emptyGate = failedGate(graph.tasks.map((task) => task.id));
  if (!input.executeTask)
    return failureResult(
      graph.graph_id,
      emptyGate,
      [],
      [],
      'WORKFLOW_EXECUTOR_REQUIRED',
      'A durable worker executor is required before a Run can complete',
      input.specVersionId,
    );

  const executeTask = input.executeTask;
  const runner = new TaskGraphRunner<
    CreateGameEvidence,
    { code: string; message: string }
  >(graph);
  const results: CreateGameTaskResult[] = [];
  try {
    await runner.execute(async (task) => {
      if (input.signal?.aborted)
        return {
          taskId: task.id,
          status: 'cancelled',
          evidence: [],
          error: { code: 'RUN_CANCELLED', message: 'Run was cancelled' },
        };
      const result = await executeTask(task);
      if (!result)
        return {
          taskId: task.id,
          status: 'failed',
          evidence: [],
          error: {
            code: 'WORKFLOW_EXECUTOR_REQUIRED',
            message: 'Task executor returned no result',
          },
        };
      if (result.taskId !== task.id)
        return {
          ...result,
          taskId: task.id,
          status: 'failed',
          error: {
            code: 'TASK_RESULT_MISMATCH',
            message: `Executor returned ${result.taskId} for ${task.id}`,
          },
        };
      const validated =
        result.status === 'completed' && result.evidence.length === 0
          ? {
              ...result,
              status: 'failed' as const,
              error: {
                code: 'EVIDENCE_REQUIRED',
                message: `Task ${task.id} completed without committed evidence`,
              },
            }
          : result;
      results.push(validated);
      await input.onProgress?.({
        task,
        result: validated,
        totalTasks: graph.tasks.length,
      });
      return validated;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow failed';
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'WORKFLOW_FAILED';
    return failureResult(
      graph.graph_id,
      gateEvidence(graph.tasks, results),
      results
        .filter((result) => result.status === 'completed')
        .map((result) => result.taskId),
      results.flatMap((result) => result.evidence),
      code,
      message,
      input.specVersionId,
    );
  }

  const completedTaskIds = results
    .filter((result) => result.status === 'completed')
    .map((result) => result.taskId);
  const evidence = results.flatMap((result) => result.evidence);
  const failed = results.find((result) => result.status !== 'completed');
  if (failed)
    return failureResult(
      graph.graph_id,
      gateEvidence(graph.tasks, results),
      completedTaskIds,
      evidence,
      failed.error?.code ?? 'TASK_FAILED',
      failed.error?.message ?? `Task ${failed.taskId} failed`,
      input.specVersionId,
    );
  if (completedTaskIds.length !== graph.tasks.length)
    return failureResult(
      graph.graph_id,
      gateEvidence(graph.tasks, results),
      completedTaskIds,
      evidence,
      'TASK_GRAPH_INCOMPLETE',
      'The worker stopped before every planned task completed',
      input.specVersionId,
    );

  const buildHash =
    evidence.find((item) => item.type === 'build' && item.contentHash)
      ?.contentHash ??
    `sha256-${createHash('sha256')
      .update(`${input.projectId}:${input.runId}:${JSON.stringify(evidence)}`)
      .digest('hex')}`;
  if (!input.publishPreview)
    return failureResult(
      graph.graph_id,
      gateEvidence(graph.tasks, results),
      completedTaskIds,
      evidence,
      'PREVIEW_PUBLISHER_REQUIRED',
      'A healthy immutable Preview publisher is required before success',
      input.specVersionId,
    );
  const publication = await input.publishPreview({
    projectId: input.projectId,
    runId: input.runId,
    buildHash,
    evidence,
  });
  const gate = gateEvidence(graph.tasks, results, publication);
  if (!gate.passed)
    return failureResult(
      graph.graph_id,
      gate,
      completedTaskIds,
      [...evidence, ...(publication.evidence ?? [])],
      'EVIDENCE_GATE_FAILED',
      'Preview publication was rejected because the evidence gate is incomplete',
      input.specVersionId,
    );
  return {
    graphId: graph.graph_id,
    status: 'succeeded',
    completedTaskIds,
    previewUrl: publication.url,
    evidenceGate: gate,
    evidence: [...evidence, ...(publication.evidence ?? [])],
    ...(input.specVersionId ? { specVersionId: input.specVersionId } : {}),
  };
}

export async function createGameFromPrompt(input: {
  projectId: string;
  runId: string;
  prompt: string;
  publish?: boolean;
  executeTask?: CreateGameWorkflowInput['executeTask'];
  publishPreview?: CreateGameWorkflowInput['publishPreview'];
  specService?: GameSpecService;
  signal?: AbortSignal;
  onProgress?: CreateGameWorkflowInput['onProgress'];
  onSpecVersionCreated?: (
    version: GameSpecVersionRecord,
  ) => Promise<void> | void;
  interpretPrompt?: RequirementInterpreter;
  beforeActivate?: () => Promise<void>;
  deferActivation?: boolean;
}): Promise<CreateGameWorkflowResult & { specHash: string }> {
  const interpretation = await (input.interpretPrompt ?? interpretRunnerPrompt)(
    input.prompt,
  );
  const specHash = hashGameSpec(interpretation.spec);
  if (interpretation.intent === 'out_of_scope')
    return {
      graphId: `rejected-${input.runId}`,
      status: 'failed',
      completedTaskIds: [],
      specHash,
      evidenceGate: failedGate(),
      evidence: [],
      failureCode: 'OUT_OF_SCOPE',
      failureMessage: interpretation.unsupportedReasons.join('; '),
    };

  const specService = input.specService ?? new GameSpecService();
  const specVersion = await specService.createVersionAndPersist({
    projectId: input.projectId,
    sourceRunId: input.runId,
    spec: interpretation.spec,
    summary: interpretation.summary,
    changeType: 'create',
  });
  await input.onSpecVersionCreated?.(specVersion);
  const publishPreview = input.publish
    ? input.publishPreview
    : async (): Promise<PreviewPublication> => ({
        healthy: false,
        url: '',
        evidence: [],
      });
  const result = await createGameWorkflow({
    projectId: input.projectId,
    runId: input.runId,
    spec: interpretation.spec,
    specVersionId: specVersion.id,
    ...(input.executeTask ? { executeTask: input.executeTask } : {}),
    ...(specService ? { specService } : {}),
    ...(publishPreview ? { publishPreview } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
  if (result.status === 'succeeded' && !input.deferActivation) {
    await input.beforeActivate?.();
    await specService.activateAndPersist(specVersion.id);
  }
  return { ...result, specHash };
}
