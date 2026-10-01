import {
  analyzeImpact,
  type ImpactSet,
  planModification,
} from '@gamerhub/game-planner';
import {
  type GameSpec,
  type GameSpecService,
  semanticDiff,
} from '@gamerhub/game-spec';
import {
  type CheckpointService,
  PreMutationCheckpointService,
} from '@gamerhub/versioning';
import { TaskGraphRunner } from './task-graph-runner';

export interface ModificationPreviewPublication {
  healthy: boolean;
  url: string;
  buildHash: string;
  evidence?: string[];
}

export interface DurableModificationResult {
  status: 'succeeded' | 'failed';
  specVersionId: string;
  specActivated: boolean;
  impact: ImpactSet;
  checkpoint: unknown;
  previewUrl?: string;
  failureCode?: string;
  failureMessage?: string;
  results: Array<{ taskId: string; status: string; evidence: string[] }>;
}

export async function modifyGameWorkflow(input: {
  deferActivation?: boolean;
  beforeActivate?: () => Promise<void>;
  projectId: string;
  runId: string;
  specVersionId: string;
  currentRevision: string;
  changedPaths: string[];
  execute?: (taskId: string) => Promise<void>;
  currentSpec?: GameSpec;
  proposedSpec?: GameSpec;
  specService?: GameSpecService;
  changeType?: 'modify' | 'rollback';
  versionSummary?: string;
  checkpointService?: CheckpointService;
  applyUnityChange?: (input: {
    taskId: string;
    changedPaths: string[];
    impact: ImpactSet;
  }) => Promise<{ evidence: string[] }>;
  executeTask?: (
    task: ReturnType<typeof planModification>['tasks'][number],
    impact: ImpactSet,
  ) => Promise<{
    status?: 'completed' | 'failed' | 'cancelled';
    evidence: string[];
    error?: string | { code: string; message: string; retryable?: boolean };
  }>;
  onProgress?: (input: {
    task: ReturnType<typeof planModification>['tasks'][number];
    status: 'completed' | 'failed' | 'cancelled';
    evidenceCount: number;
    totalTasks: number;
  }) => Promise<void> | void;
  runTargetedChecks?: (
    impact: ImpactSet,
  ) => Promise<{ passed: boolean; evidence: string[] }>;
  publishPreview?: (input: {
    specVersionId: string;
    checkpoint: unknown;
    impact: ImpactSet;
  }) => Promise<ModificationPreviewPublication>;
  onCheckpointCreated?: (checkpoint: unknown) => Promise<void> | void;
}) {
  const checkpoints = new PreMutationCheckpointService();
  const preMutationCheckpoint = checkpoints.create({
    projectId: input.projectId,
    runId: input.runId,
    expectedRevision: input.currentRevision,
    changeManifest: { paths: input.changedPaths },
  });
  let checkpoint: unknown = preMutationCheckpoint;
  let specVersionId = input.specVersionId;
  let impact = analyzeImpact({ changedPaths: input.changedPaths });
  let specActivated = false;
  const requiresDurableExecution = Boolean(
    input.currentSpec || input.proposedSpec || input.specService,
  );
  if (requiresDurableExecution && !input.executeTask)
    throw new Error('MODIFICATION_EXECUTOR_REQUIRED');
  if (requiresDurableExecution && !input.checkpointService)
    throw new Error('MODIFICATION_CHECKPOINT_SERVICE_REQUIRED');
  if (input.currentSpec || input.proposedSpec || input.specService) {
    if (!input.currentSpec || !input.proposedSpec || !input.specService)
      throw new Error('MODIFICATION_SPEC_REQUIRED');
    const diff = semanticDiff(input.currentSpec, input.proposedSpec);
    const changedPaths =
      diff.changedPaths.length > 0 ? diff.changedPaths : input.changedPaths;
    impact = analyzeImpact({ changedPaths });
    const next = await input.specService.createVersionAndPersist({
      projectId: input.projectId,
      sourceRunId: input.runId,
      spec: input.proposedSpec,
      summary: input.versionSummary ?? '局部修改已写入 Game Spec 提案',
      changeType: input.changeType ?? 'modify',
      parentVersionId: input.specVersionId,
    });
    specVersionId = next.id;
    if (input.checkpointService)
      checkpoint = await input.checkpointService.create({
        projectId: input.projectId,
        specVersionId: next.id,
        sourceRunId: input.runId,
        commitRef: input.currentRevision,
        summary: 'Pre-modification checkpoint',
        changeManifest: { paths: changedPaths },
      });
    await input.onCheckpointCreated?.(checkpoint);
  }
  const graph = planModification({
    ...input,
    restoreSource: input.changeType === 'rollback',
    ...(input.proposedSpec
      ? {
          spec: input.proposedSpec,
          ...(input.currentSpec ? { previousSpec: input.currentSpec } : {}),
          rebuild:
            input.currentSpec?.game.genre !== input.proposedSpec.game.genre,
        }
      : {}),
    specVersionId,
    changedPaths: impact.files.length ? impact.files : input.changedPaths,
  });
  const runner = new TaskGraphRunner<
    string,
    string | { code: string; message: string; retryable?: boolean }
  >(graph);
  const results = await runner.execute(async (task) => {
    checkpoints.assertExpectedRevision(
      preMutationCheckpoint.id,
      input.currentRevision,
    );
    const evidence: string[] = [];
    if (input.applyUnityChange && task.type === 'component') {
      const applied = await input.applyUnityChange({
        taskId: task.id,
        changedPaths: input.changedPaths,
        impact,
      });
      evidence.push(...applied.evidence);
    }
    if (input.executeTask) {
      const executed = await input.executeTask(task, impact);
      if (executed.status && executed.status !== 'completed') {
        await input.onProgress?.({
          task,
          status: executed.status,
          evidenceCount: executed.evidence.length,
          totalTasks: graph.tasks.length,
        });
        return {
          taskId: task.id,
          status: executed.status,
          evidence: executed.evidence,
          error: executed.error ?? 'TASK_EXECUTION_FAILED',
        };
      }
      evidence.push(...executed.evidence);
      if (evidence.length === 0)
        return {
          taskId: task.id,
          status: 'failed' as const,
          evidence: [],
          error: 'TASK_EVIDENCE_REQUIRED',
        };
    }
    await input.execute?.(task.id);
    const completed = {
      taskId: task.id,
      status: 'completed' as const,
      evidence: [
        ...new Set(
          evidence.length ? evidence : [task.validation_method.reference],
        ),
      ],
    };
    await input.onProgress?.({
      task,
      status: completed.status,
      evidenceCount: completed.evidence.length,
      totalTasks: graph.tasks.length,
    });
    return completed;
  });
  const allTasksCompleted = results.every(
    (result) => result.status === 'completed',
  );
  if (!allTasksCompleted) {
    const failed = results.find((result) => result.status !== 'completed');
    const error = failed?.error;
    return {
      status: 'failed',
      specVersionId,
      specActivated,
      impact,
      checkpoint,
      failureCode:
        typeof error === 'string'
          ? error
          : (error?.code ?? 'MODIFICATION_TASK_FAILED'),
      failureMessage:
        typeof error === 'object'
          ? error.message
          : 'A modification task failed',
      results,
    } satisfies DurableModificationResult;
  }
  if (input.runTargetedChecks) {
    const checks = await input.runTargetedChecks(impact);
    if (!checks.passed)
      return {
        status: 'failed',
        specVersionId,
        specActivated,
        impact,
        checkpoint,
        failureCode: 'TARGETED_CHECK_FAILED',
        results: results.map((result) => ({ ...result })),
      } satisfies DurableModificationResult;
  }
  if (input.publishPreview) {
    const publication = await input.publishPreview({
      specVersionId,
      checkpoint,
      impact,
    });
    if (!publication.healthy || !publication.url || !publication.buildHash)
      return {
        status: 'failed',
        specVersionId,
        specActivated,
        impact,
        checkpoint,
        failureCode: 'PREVIEW_PUBLICATION_FAILED',
        results: results.map((result) => ({ ...result })),
      } satisfies DurableModificationResult;
    if (input.specService && !input.deferActivation) {
      await input.beforeActivate?.();
      await input.specService.activateAndPersist(specVersionId);
      specActivated = true;
    }
    return {
      status: 'succeeded',
      specVersionId,
      specActivated,
      impact,
      checkpoint,
      previewUrl: publication.url,
      results: results.map((result) => ({ ...result })),
    } satisfies DurableModificationResult;
  }
  if (requiresDurableExecution)
    return {
      status: 'failed',
      specVersionId,
      specActivated,
      impact,
      checkpoint,
      failureCode: 'PREVIEW_PUBLISHER_REQUIRED',
      results: results.map((result) => ({ ...result })),
    } satisfies DurableModificationResult;
  return {
    checkpoint,
    graph,
    results,
    status: allTasksCompleted ? ('succeeded' as const) : ('failed' as const),
  };
}
