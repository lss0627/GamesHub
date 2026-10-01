import { randomUUID } from 'node:crypto';
import type { AgentKernel, AgentKernelPolicy } from '@gamerhub/agent-runtime';
import {
  assertRunLease,
  InMemoryPlatformStore,
  type PlatformStore,
  PostgresDomainRepository,
  type Run,
  terminalRunStatuses,
} from '@gamerhub/domain';
import type { PlannerTask } from '@gamerhub/game-planner';
import {
  type GameSpec,
  GameSpecService,
  interpretRunnerPrompt,
  type RequirementInterpreter,
  semanticDiff,
} from '@gamerhub/game-spec';
import { RedisRunSignal } from '@gamerhub/runtime-infra';
import type { CheckpointService } from '@gamerhub/versioning';
import {
  GitCheckpointStore,
  PostgresCheckpointMetadataStore,
} from '@gamerhub/versioning';
import { PostgresGameSpecPersistence } from './persistence/postgres-game-spec';
import { createRunEventAgentKernel } from './runtime/run-event-agent';
import {
  type CreateGameEvidence,
  type CreateGameTaskResult,
  createGameFromPrompt,
  type PreviewPublication,
  type TestVerification,
} from './workflows/create-game';
import { publicTestVerification } from './workflows/delivery-evidence';
import { modifyGameWorkflow } from './workflows/modify-game';

interface WorkerWorkflowResult {
  status: 'succeeded' | 'failed';
  evidence: CreateGameEvidence[];
  evidenceGate?: { passed: boolean };
  specVersionId?: string;
  previewUrl?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface WorkerExecutionContext {
  specVersionId?: string;
  checkpointId?: string;
  checkpointRef?: string;
  gameSpec?: GameSpec;
}

export interface WorkerTaskExecutor {
  restoreResult?(
    task: PlannerTask,
    runId: string,
    result: CreateGameTaskResult,
  ): void | Promise<void>;
  execute(
    task: PlannerTask,
    runId: string,
    trace?: { traceId: string; spanId: string },
  ): Promise<CreateGameTaskResult>;
}

export function workerHealth() {
  return {
    status: 'ready',
    service: 'orchestrator-worker',
    licenseIdentifiersExposed: false,
  } as const;
}

export interface OrchestratorWorkerOptions {
  store?: PlatformStore;
  workerId?: string;
  leaseSeconds?: number;
  taskExecutor?: WorkerTaskExecutor;
  taskExecutorFactory?: (input: {
    run: Run;
    context: WorkerExecutionContext;
  }) => WorkerTaskExecutor | Promise<WorkerTaskExecutor>;
  executeTask?: (task: PlannerTask, run: Run) => Promise<CreateGameTaskResult>;
  specService?: GameSpecService;
  checkpointService?: CheckpointService;
  sourceRevision?: (run: Run) => Promise<string>;
  restoreSourceVersion?: (run: Run, versionId: string) => Promise<void>;
  prepareSource?: (run: Run) => Promise<void>;
  settleSource?: (
    run: Run,
    outcome: 'succeeded' | 'failed' | 'cancelled',
  ) => Promise<{ status: string; archived?: boolean }>;
  interpretPrompt?: RequirementInterpreter;
  agentKernel?: Pick<AgentKernel, 'executeAction' | 'finalize'>;
  agentPolicy?: (run: Run) => AgentKernelPolicy;
  publishPreview?: (input: {
    projectId: string;
    runId: string;
    traceId: string;
    buildHash: string;
    evidence: CreateGameEvidence[];
    specVersionId?: string;
  }) => Promise<PreviewPublication>;
}

export interface WorkerProcessResult {
  run: Run;
  status: 'succeeded' | 'failed' | 'paused' | 'cancelled' | 'interrupted';
  failureCode?: string;
  previewUrl?: string;
}

async function waitForWorkerPoll(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function runWorkerLoop(
  worker: Pick<OrchestratorWorker, 'processNext'>,
  options: {
    pollIntervalMs?: number;
    signal?: AbortSignal;
    waitForWork?: (timeoutMs: number, signal?: AbortSignal) => Promise<void>;
    onError?: (error: unknown) => void;
  } = {},
): Promise<void> {
  const configuredInterval = options.pollIntervalMs ?? 1000;
  const pollIntervalMs = Number.isFinite(configuredInterval)
    ? Math.max(100, configuredInterval)
    : 1000;
  while (!options.signal?.aborted) {
    let result: WorkerProcessResult | undefined;
    try {
      result = await worker.processNext();
    } catch (error) {
      if (options.onError) options.onError(error);
      else
        console.error('Worker iteration failed; retrying after backoff', error);
      await waitForWorkerPoll(pollIntervalMs, options.signal);
      continue;
    }
    if (!result && options.waitForWork) {
      try {
        await options.waitForWork(pollIntervalMs, options.signal);
      } catch (error) {
        options.onError?.(error);
        await waitForWorkerPoll(pollIntervalMs, options.signal);
      }
    } else if (!result) await waitForWorkerPoll(pollIntervalMs, options.signal);
  }
}

export async function startConfiguredWorker(): Promise<void> {
  const { createProductionWorker } = await import('./runtime/production');
  const runtime = createProductionWorker();
  const runSignal = process.env.REDIS_URL
    ? await RedisRunSignal.connect(process.env.REDIS_URL)
    : undefined;
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runWorkerLoop(runtime.worker, {
      signal: controller.signal,
      pollIntervalMs: Number(process.env.GAMERHUB_WORKER_POLL_MS ?? 1000),
      ...(runSignal
        ? {
            waitForWork: (timeoutMs: number, signal?: AbortSignal) =>
              runSignal.wait(timeoutMs, signal),
          }
        : {}),
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await Promise.allSettled([runSignal?.close(), runtime.close()]);
  }
}

export class OrchestratorWorker {
  private readonly store: PlatformStore;
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly specService: GameSpecService;
  private readonly checkpointService: CheckpointService | undefined;
  private readonly sourceRevision: ((run: Run) => Promise<string>) | undefined;
  private readonly interpretPrompt: RequirementInterpreter;
  private readonly agentKernel: Pick<AgentKernel, 'executeAction' | 'finalize'>;
  private readonly agentPolicy: (run: Run) => AgentKernelPolicy;
  private readonly preparedPreviews = new Map<string, string>();
  private readonly testVerification = new Map<
    string,
    Map<string, TestVerification>
  >();

  constructor(private readonly options: OrchestratorWorkerOptions = {}) {
    this.store = options.store ?? configuredStore();
    this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID()}`;
    this.leaseSeconds = options.leaseSeconds ?? 120;
    this.specService =
      options.specService ??
      new GameSpecService(
        this.store instanceof PostgresDomainRepository
          ? new PostgresGameSpecPersistence(this.store)
          : undefined,
      );
    const configuredCheckpoint = configuredCheckpointService(this.store);
    this.checkpointService =
      options.checkpointService ?? configuredCheckpoint?.service;
    this.sourceRevision =
      options.sourceRevision ?? configuredCheckpoint?.sourceRevision;
    this.interpretPrompt = options.interpretPrompt ?? interpretRunnerPrompt;
    this.agentKernel =
      options.agentKernel ?? createRunEventAgentKernel(this.store);
    this.agentPolicy = options.agentPolicy ?? defaultAgentPolicy;
  }

  async processNext(): Promise<WorkerProcessResult | undefined> {
    const claimed = await this.store.claimNextRun(
      this.workerId,
      this.leaseSeconds,
    );
    if (!claimed) return undefined;
    let current = claimed;
    let heartbeatError: unknown;
    let heartbeatPending: Promise<void> | undefined;
    let sourcePrepared = false;
    const settleSource = async (
      outcome: 'succeeded' | 'failed' | 'cancelled',
    ) => {
      if (!sourcePrepared || !this.options.settleSource) return;
      const owned = await this.store.getRunForWorker(current.id);
      if (outcome === 'succeeded') {
        if (owned.status !== 'succeeded')
          throw new Error('SOURCE_COMMIT_REQUIRES_PUBLICATION');
      } else assertRunLease(owned, this.workerId);
      sourcePrepared = false;
      try {
        const recovery = await this.options.settleSource(owned, outcome);
        if (outcome !== 'succeeded')
          await this.store.appendEvent({
            runId: current.id,
            eventType: 'run.source.recovered',
            visibility: 'creator',
            payload: {
              status: recovery.status,
              archived: recovery.archived === true,
            },
          });
      } catch {
        await this.store.appendEvent({
          runId: current.id,
          eventType:
            outcome === 'succeeded'
              ? 'run.source.commit_pending'
              : 'run.source.recovery_failed',
          visibility: 'creator',
          payload: {
            code:
              outcome === 'succeeded'
                ? 'SOURCE_COMMIT_PENDING'
                : 'SOURCE_RECOVERY_FAILED',
            retryBeforeNextRun: true,
          },
        });
        throw Object.assign(
          new Error('工程恢复尚未完成，下一次制作前将先重试恢复。'),
          { code: 'SOURCE_RECOVERY_FAILED' },
        );
      }
    };
    const heartbeat = setInterval(
      () => {
        if (heartbeatPending || heartbeatError) return;
        heartbeatPending = this.store
          .updateRun(
            claimed.id,
            {
              leaseExpiresAt: new Date(
                Date.now() + this.leaseSeconds * 1000,
              ).toISOString(),
            },
            this.workerId,
          )
          .then(() => undefined)
          .catch((error: unknown) => {
            heartbeatError = error;
          })
          .finally(() => {
            heartbeatPending = undefined;
          });
      },
      Math.max(100, (this.leaseSeconds * 1000) / 3),
    );
    heartbeat.unref();
    try {
      await this.assertRunnable(current);
      await this.options.prepareSource?.(current);
      sourcePrepared = Boolean(this.options.prepareSource);
      if (current.status === 'planning') {
        const executing = await this.store.transitionRun(
          current.id,
          'executing',
          {
            eventType: 'run.executing',
            visibility: 'developer',
            payload: { workerId: this.workerId },
          },
          this.workerId,
        );
        current = executing.run;
      }
      const result = await this.executeWorkflow(current);
      if (heartbeatError) throw heartbeatError;
      await this.assertRunnable(current);
      if (result.status !== 'succeeded') {
        await settleSource('failed');
        current = await this.failRun(
          current,
          result.failureCode ?? 'WORKFLOW_FAILED',
          result.failureMessage,
        );
        await this.agentKernel
          .finalize(current.id, 'failed', {
            failureCode: result.failureCode ?? 'WORKFLOW_FAILED',
          })
          .catch(() => undefined);
        return {
          run: current,
          status: 'failed',
          ...(result.failureCode ? { failureCode: result.failureCode } : {}),
        };
      }
      current = (
        await this.store.transitionRun(
          current.id,
          'playtesting',
          {
            eventType: 'run.playtesting',
            visibility: 'developer',
            payload: {
              evidenceCount: result.evidence.length,
              specVersionId: result.specVersionId,
            },
          },
          this.workerId,
        )
      ).run;
      current = (
        await this.store.transitionRun(
          current.id,
          'evaluating',
          {
            eventType: 'run.evaluating',
            visibility: 'developer',
            payload: { evidenceGate: result.evidenceGate ?? { passed: true } },
          },
          this.workerId,
        )
      ).run;
      if (this.store instanceof PostgresDomainRepository) {
        const previewId = this.preparedPreviews.get(current.id);
        if (!previewId || !result.specVersionId || !result.previewUrl)
          throw new Error('PUBLICATION_CONTEXT_REQUIRED');
        current = await this.store.commitRunPublication({
          projectId: current.projectId,
          runId: current.id,
          workerId: this.workerId,
          specVersionId: result.specVersionId,
          previewId,
          previewUrl: result.previewUrl,
          evidenceCount: result.evidence.length,
        });
      } else {
        current = (
          await this.store.transitionRun(
            current.id,
            'succeeded',
            {
              eventType: 'run.succeeded',
              visibility: 'creator',
              payload: {
                previewUrl: result.previewUrl,
                specVersionId: result.specVersionId ?? null,
                evidenceCount: result.evidence.length,
              },
            },
            this.workerId,
          )
        ).run;
        current = await this.store.updateRun(
          current.id,
          {
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            finishedAt: new Date().toISOString(),
            resultSummary: result.previewUrl ?? 'Preview published',
          },
          this.workerId,
        );
      }
      // Diagnostics must not reverse an already committed publication.
      await settleSource('succeeded').catch(() => undefined);
      await this.agentKernel
        .finalize(current.id, 'succeeded', {
          evidenceCount: result.evidence.length,
          specVersionId: result.specVersionId ?? null,
        })
        .catch(() => undefined);
      return {
        run: current,
        status: 'succeeded',
        ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
      };
    } catch (error) {
      const actual = await this.store.getRunForWorker(current.id);
      if (actual.status === 'succeeded') {
        await settleSource('succeeded').catch(() => undefined);
        return {
          run: actual,
          status: 'succeeded',
          ...(actual.resultSummary ? { previewUrl: actual.resultSummary } : {}),
        };
      }
      if (
        actual.leaseOwner !== this.workerId ||
        !actual.leaseExpiresAt ||
        Date.parse(actual.leaseExpiresAt) <= Date.now()
      )
        return { run: actual, status: 'interrupted' };
      if (actual.status === 'pause_requested') {
        const recovery = await this.store.appendEvent({
          runId: actual.id,
          eventType: 'run.recovery_point',
          visibility: 'developer',
          payload: { reason: 'creator_pause', boundary: 'between_tools' },
        });
        await this.store.updateRun(
          actual.id,
          { recoverySequence: recovery.sequence },
          this.workerId,
        );
        current = (
          await this.store.transitionRun(
            actual.id,
            'paused',
            {
              eventType: 'run.paused',
              visibility: 'creator',
              payload: {
                recovery_sequence: recovery.sequence,
                resources_released: true,
              },
            },
            this.workerId,
          )
        ).run;
        current = await this.store.updateRun(
          current.id,
          { leaseOwner: undefined, leaseExpiresAt: undefined },
          this.workerId,
        );
        return { run: current, status: 'paused' };
      }
      if (
        terminalRunStatuses.has(actual.status) ||
        actual.status === 'paused'
      ) {
        if (actual.status !== 'paused')
          await settleSource(
            actual.status === 'cancelled' ? 'cancelled' : 'failed',
          ).catch(() => undefined);
        current = await this.store.updateRun(
          actual.id,
          { leaseOwner: undefined, leaseExpiresAt: undefined },
          this.workerId,
        );
        if (actual.status === 'cancelled')
          await this.agentKernel
            .finalize(actual.id, 'cancelled', {
              reason: 'creator_cancel',
              resourcesReleased: true,
            })
            .catch(() => undefined);
        return {
          run: current,
          status: actual.status === 'cancelled' ? 'cancelled' : 'interrupted',
        };
      }
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'WORKER_FAILED';
      let recoveryFailed = false;
      await settleSource('failed').catch(() => {
        recoveryFailed = true;
      });
      current = await this.failRun(
        current,
        recoveryFailed ? 'SOURCE_RECOVERY_FAILED' : code,
        recoveryFailed
          ? '工程恢复尚未完成，下一次制作前将先重试恢复。'
          : error instanceof Error
            ? error.message
            : 'Worker failed',
      );
      await this.agentKernel
        .finalize(current.id, 'failed', {
          failureCode: recoveryFailed ? 'SOURCE_RECOVERY_FAILED' : code,
        })
        .catch(() => undefined);
      return {
        run: current,
        status: 'failed',
        failureCode: recoveryFailed ? 'SOURCE_RECOVERY_FAILED' : code,
      };
    } finally {
      clearInterval(heartbeat);
      await heartbeatPending;
      this.preparedPreviews.delete(claimed.id);
      this.testVerification.delete(claimed.id);
    }
  }

  async runUntilIdle(maxRuns = 100): Promise<WorkerProcessResult[]> {
    const results: WorkerProcessResult[] = [];
    while (results.length < maxRuns) {
      const result = await this.processNext();
      if (!result) break;
      results.push(result);
    }
    return results;
  }

  private async executeWorkflow(run: Run): Promise<WorkerWorkflowResult> {
    if (run.requestType === 'modify' || run.requestType === 'rollback')
      return this.executeSpecificationChange(run);
    const context: WorkerExecutionContext = {};
    const result = await createGameFromPrompt({
      projectId: run.projectId,
      runId: run.id,
      prompt: run.userInput,
      publish: true,
      deferActivation: this.store instanceof PostgresDomainRepository,
      beforeActivate: () => this.assertRunnable(run),
      specService: this.specService,
      interpretPrompt: (prompt) => this.interpretWithAgent(run, prompt),
      ...(this.hasTaskExecutor()
        ? {
            executeTask: (task: PlannerTask) =>
              this.executeTask(task, run, context),
          }
        : {}),
      ...(this.options.publishPreview
        ? {
            publishPreview: (input: {
              projectId: string;
              runId: string;
              buildHash: string;
              evidence: CreateGameEvidence[];
            }) => this.publishForRun(run, input, context.specVersionId),
          }
        : {}),
      onProgress: async ({ task, result: taskResult, totalTasks }) => {
        await this.store.appendEvent({
          runId: run.id,
          eventType: 'task.progress',
          visibility: 'creator',
          payload: {
            taskId: task.id,
            taskType: task.type,
            status: taskResult.status,
            evidenceCount: taskResult.evidence.length,
            totalTasks,
          },
        });
      },
      onSpecVersionCreated: async (version) => {
        await this.assertRunnable(run);
        context.specVersionId = version.id;
        context.gameSpec = version.spec;
        if (!this.checkpointService) return;
        if (!this.sourceRevision)
          throw new Error('CREATION_SOURCE_REVISION_REQUIRED');
        const checkpoint = await this.checkpointService.create({
          projectId: run.projectId,
          specVersionId: version.id,
          sourceRunId: run.id,
          commitRef: await this.sourceRevision(run),
          summary: 'Pre-creation checkpoint',
          changeManifest: { paths: [] },
        });
        this.captureCheckpointContext(context, checkpoint);
      },
    });
    return result;
  }

  private async assertRunnable(run: Run): Promise<void> {
    const current = await this.store.getRunForWorker(run.id);
    assertRunLease(current, this.workerId);
    if (
      current.status === 'pause_requested' ||
      current.status === 'paused' ||
      terminalRunStatuses.has(current.status)
    )
      throw Object.assign(
        new Error('Run was interrupted by a control request'),
        { code: 'RUN_INTERRUPTED' },
      );
  }

  private async publishForRun(
    run: Run,
    input: {
      projectId: string;
      runId: string;
      buildHash: string;
      evidence: CreateGameEvidence[];
    },
    specVersionId?: string,
  ): Promise<PreviewPublication> {
    await this.assertRunnable(run);
    const result = await this.options.publishPreview?.({
      ...input,
      traceId: run.traceId,
      ...(specVersionId ? { specVersionId } : {}),
    });
    await this.assertRunnable(run);
    if (result?.browser) {
      const browser = result.browser;
      if (
        !result.healthy ||
        !browser.passed ||
        browser.runId !== run.id ||
        browser.specVersionId !== specVersionId ||
        browser.buildHash !== result.buildHash ||
        !/^sha256-[a-f0-9]{64}$/.test(browser.reportHash)
      )
        throw Object.assign(new Error('试玩证据与当前任务或版本不符。'), {
          code: 'BROWSER_EVIDENCE_MISMATCH',
        });
    }
    if (result?.healthy && this.store instanceof PostgresDomainRepository) {
      const previewId =
        result.previewId ??
        (await this.store.savePreview({
          projectId: run.projectId,
          buildContentHash: input.buildHash,
          publicSlug: new URL(result.url).pathname,
          origin: new URL(result.url).origin,
          status: 'prepared',
          sourceRunId: run.id,
        }));
      this.preparedPreviews.set(run.id, previewId);
    }
    if (result?.browser) {
      const browser = result.browser;
      await this.store.appendEvent({
        runId: run.id,
        eventType: 'run.delivery.prepared',
        visibility: 'creator',
        payload: {
          runId: run.id,
          specVersionId,
          buildHash: browser.buildHash,
          ...(this.preparedPreviews.get(run.id)
            ? { previewId: this.preparedPreviews.get(run.id) }
            : {}),
          tests: [...(this.testVerification.get(run.id)?.values() ?? [])],
          browser: {
            passed: true,
            reportHash: browser.reportHash,
            checks: browser.checks.slice(0, 12).map((check) => ({
              id: /^[a-z-]{1,60}$/.test(check.id) ? check.id : 'unknown',
              status: check.status === 'passed' ? 'passed' : 'failed',
              durationMs: Math.max(
                0,
                Math.min(180000, Math.floor(check.durationMs)),
              ),
            })),
          },
        },
      });
    }
    return (
      result ?? {
        healthy: false,
        url: '',
        buildHash: input.buildHash,
        evidence: [],
      }
    );
  }

  private async executeSpecificationChange(
    run: Run,
  ): Promise<WorkerWorkflowResult> {
    const versions = await this.specService.listDurably(run.projectId);
    const activeVersion = versions
      .filter((version) => version.status === 'active')
      .at(-1);
    if (!activeVersion)
      return {
        status: 'failed',
        evidence: [],
        failureCode: 'CURRENT_SPEC_REQUIRED',
        failureMessage:
          'A specification change requires an active Game Spec version',
      };
    let proposedSpec: GameSpec;
    let changeType: 'modify' | 'rollback';
    let versionSummary: string;
    if (run.requestType === 'rollback') {
      const targetVersion = versions.find(
        (version) => version.id === run.userInput,
      );
      if (!targetVersion)
        return {
          status: 'failed',
          evidence: [],
          failureCode: 'RESTORE_VERSION_NOT_FOUND',
          failureMessage: 'The requested Game Spec version was not found',
        };
      proposedSpec = targetVersion.spec;
      changeType = 'rollback';
      versionSummary = `恢复版本 #${targetVersion.versionNumber}：${targetVersion.summary}`;
    } else {
      const interpretation = await this.interpretWithAgent(
        run,
        run.userInput,
        activeVersion.spec,
      );
      if (interpretation.intent !== 'modify')
        return {
          status: 'failed',
          evidence: [],
          failureCode:
            interpretation.intent === 'out_of_scope'
              ? 'OUT_OF_SCOPE'
              : 'MODIFICATION_INTENT_REQUIRED',
          failureMessage:
            interpretation.unsupportedReasons.join('; ') ||
            'The request did not produce a supported local change',
        };
      proposedSpec = interpretation.spec;
      changeType = 'modify';
      versionSummary = '局部修改已写入 Game Spec 提案';
    }
    const diff = semanticDiff(activeVersion.spec, proposedSpec);
    if (diff.changedPaths.length === 0 && run.requestType !== 'rollback')
      return {
        status: 'failed',
        evidence: [],
        failureCode: 'NO_SUPPORTED_CHANGE',
        failureMessage: 'The modification did not change the current Game Spec',
      };

    const evidence: CreateGameEvidence[] = [];
    if (this.checkpointService && !this.sourceRevision)
      throw new Error('MODIFICATION_SOURCE_REVISION_REQUIRED');
    const currentRevision = await (this.sourceRevision?.(run) ??
      Promise.resolve(activeVersion.contentHash));
    const context: WorkerExecutionContext = {
      specVersionId: activeVersion.id,
      checkpointRef: currentRevision,
      gameSpec: proposedSpec,
    };
    const result = await modifyGameWorkflow({
      deferActivation: this.store instanceof PostgresDomainRepository,
      beforeActivate: () => this.assertRunnable(run),
      projectId: run.projectId,
      runId: run.id,
      specVersionId: activeVersion.id,
      currentRevision,
      changedPaths: diff.changedPaths.length ? diff.changedPaths : ['/game'],
      currentSpec: activeVersion.spec,
      proposedSpec,
      changeType,
      versionSummary,
      specService: this.specService,
      ...(this.checkpointService
        ? { checkpointService: this.checkpointService }
        : {}),
      ...(this.hasTaskExecutor()
        ? {
            executeTask: async (task) => {
              const taskResult = await this.executeTask(task, run, context);
              evidence.push(...taskResult.evidence);
              return {
                status: taskResult.status,
                evidence: taskResult.evidence.map((item) => item.reference),
                ...(taskResult.error ? { error: taskResult.error } : {}),
              };
            },
          }
        : {}),
      onProgress: async ({ task, status, evidenceCount, totalTasks }) => {
        await this.store.appendEvent({
          runId: run.id,
          eventType: 'task.progress',
          visibility: 'creator',
          payload: {
            taskId: task.id,
            taskType: task.type,
            status,
            evidenceCount,
            totalTasks,
          },
        });
      },
      onCheckpointCreated: async (checkpoint) => {
        this.captureCheckpointContext(context, checkpoint);
        if (
          run.requestType === 'rollback' &&
          this.options.restoreSourceVersion
        ) {
          await this.assertRunnable(run);
          await this.options.restoreSourceVersion(run, run.userInput);
        }
      },
      publishPreview: async ({ specVersionId, impact }) => {
        const buildHash =
          evidence.find((item) => item.type === 'build' && item.contentHash)
            ?.contentHash ?? `sha256-${run.id}-${specVersionId}`;
        if (!this.options.publishPreview)
          return { healthy: false, url: '', buildHash, evidence: [] };
        const publication = await this.publishForRun(
          run,
          {
            projectId: run.projectId,
            runId: run.id,
            buildHash,
            evidence,
          },
          specVersionId,
        );
        return {
          healthy: publication.healthy,
          url: publication.url,
          buildHash: publication.buildHash ?? buildHash,
          evidence: [
            ...(publication.evidence ?? []).map((item) => item.reference),
            `impact:${impact.files.join(',')}`,
          ],
        };
      },
    });
    return {
      status: result.status,
      evidence: [
        ...evidence,
        ...result.results.flatMap((item) =>
          item.evidence.map((reference) => ({
            type: 'modification',
            reference,
          })),
        ),
      ],
      ...(result.specVersionId ? { specVersionId: result.specVersionId } : {}),
      ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      ...(result.failureMessage
        ? { failureMessage: result.failureMessage }
        : {}),
      evidenceGate: { passed: result.status === 'succeeded' },
    };
  }

  private hasTaskExecutor(): boolean {
    return Boolean(
      this.options.executeTask ||
        this.options.taskExecutor ||
        this.options.taskExecutorFactory,
    );
  }

  private async interpretWithAgent(
    run: Run,
    prompt: string,
    currentSpec?: GameSpec,
  ): Promise<Awaited<ReturnType<RequirementInterpreter>>> {
    await this.assertRunnable(run);
    const result = await this.agentKernel.executeAction({
      runId: run.id,
      sessionId: run.sessionId,
      traceId: run.traceId,
      policy: this.agentPolicy(run),
      action: {
        id: 'interpret-game-spec',
        idempotencyKey: `${run.id}:interpret-game-spec`,
        input: { prompt, currentSpec },
        tool: {
          name: 'model.game-spec.interpret',
          version: '1.0.0',
          safetyClass: 'model_inference',
          idempotent: true,
          timeoutMs: 2 * 60 * 1000,
          invoke: async () => this.interpretPrompt(prompt, currentSpec),
        },
        summarizeInput: (input) => ({
          promptCharacters: input.prompt.length,
          hasCurrentSpec: Boolean(input.currentSpec),
        }),
        summarizeOutput: (output) => ({
          intent: output.intent,
          unsupportedReasonCount: output.unsupportedReasons.length,
        }),
      },
    });
    await this.assertRunnable(run);
    return result.output;
  }

  private async executeTask(
    task: PlannerTask,
    run: Run,
    context: WorkerExecutionContext = {},
  ): Promise<CreateGameTaskResult> {
    await this.assertRunnable(run);
    const result = await this.agentKernel.executeAction({
      runId: run.id,
      sessionId: run.sessionId,
      traceId: run.traceId,
      policy: this.agentPolicy(run),
      action: {
        id: task.id,
        idempotencyKey: `${run.id}:${task.id}`,
        input: { task, runId: run.id },
        tool: {
          name: 'unity.task.execute',
          version: '1.0.0',
          safetyClass: 'engine_mutation',
          // Completed actions replay their saved result. An interrupted Unity
          // task may already have applied some operations; never blindly repeat it.
          idempotent: task.type === 'spec' || task.type === 'publish',
          timeoutMs: 30 * 60 * 1000,
          invoke: (_input, trace) =>
            this.executeTaskDirect(task, run, context, trace),
        },
        summarizeInput: () => ({
          taskId: task.id,
          taskType: task.type,
          dependencies: task.dependencies,
          validation: task.validation_method.type,
        }),
        summarizeOutput: (output) => ({
          taskId: output.taskId,
          status: output.status,
          evidenceCount: output.evidence.length,
          changedArtifactCount: output.changedArtifacts?.length ?? 0,
        }),
        assess: (output) => ({
          succeeded: output.status === 'completed',
          ...(output.error
            ? {
                code: output.error.code,
                message: output.error.message,
                retryable:
                  output.error.retryable ??
                  isRetryableUnityFailure(output.error.code),
              }
            : {}),
        }),
      },
    });
    await this.assertRunnable(run);
    if (
      result.replayed &&
      result.output.status === 'completed' &&
      !this.options.executeTask
    ) {
      const executor =
        this.options.taskExecutor ??
        (await this.options.taskExecutorFactory?.({ run, context }));
      await executor?.restoreResult?.(task, run.id, result.output);
    }
    if (result.output.verification?.length) {
      const verification = publicTestVerification(result.output.verification);
      const known =
        this.testVerification.get(run.id) ??
        new Map<string, TestVerification>();
      for (const suite of verification) known.set(suite.suite, suite);
      this.testVerification.set(run.id, known);
      await this.store.appendEvent({
        runId: run.id,
        eventType: 'task.verification',
        visibility: 'creator',
        payload: {
          taskId: task.id,
          status: result.output.status,
          verification,
        },
      });
    }
    return result.output;
  }

  private async executeTaskDirect(
    task: PlannerTask,
    run: Run,
    context: WorkerExecutionContext,
    trace: { traceId: string; spanId: string },
  ): Promise<CreateGameTaskResult> {
    if (this.options.executeTask) return this.options.executeTask(task, run);
    if (this.options.taskExecutor)
      return this.options.taskExecutor.execute(task, run.id, trace);
    if (this.options.taskExecutorFactory) {
      const executor = await this.options.taskExecutorFactory({ run, context });
      return executor.execute(task, run.id, trace);
    }
    return {
      taskId: task.id,
      status: 'failed',
      evidence: [],
      error: {
        code: 'WORKFLOW_EXECUTOR_REQUIRED',
        message: 'A real task executor is required',
      },
    };
  }

  private captureCheckpointContext(
    context: WorkerExecutionContext,
    checkpoint: unknown,
  ): void {
    if (!checkpoint || typeof checkpoint !== 'object')
      throw new Error('CHECKPOINT_CONTEXT_INVALID');
    const value = checkpoint as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.commitRef !== 'string')
      throw new Error('CHECKPOINT_CONTEXT_INVALID');
    context.checkpointId = value.id;
    context.checkpointRef = value.commitRef;
    if (typeof value.specVersionId === 'string')
      context.specVersionId = value.specVersionId;
  }

  private async failRun(
    run: Run,
    code: string,
    message?: string,
  ): Promise<Run> {
    let current = await this.store.getRunForWorker(run.id);
    assertRunLease(current, this.workerId);
    if (
      ![
        'failed',
        'cancelled',
        'succeeded',
        'partially_succeeded',
        'timed_out',
      ].includes(current.status)
    ) {
      current = (
        await this.store.transitionRun(
          current.id,
          'failed',
          {
            eventType: 'run.failed',
            visibility: 'creator',
            payload: { code, message: message ?? 'Worker failed' },
          },
          this.workerId,
        )
      ).run;
    }
    return this.store.updateRun(
      current.id,
      {
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        finishedAt: new Date().toISOString(),
        ...(current.status === 'failed'
          ? { resultSummary: `${code}: ${message ?? 'Worker failed'}` }
          : {}),
      },
      this.workerId,
    );
  }
}

export type { UnityTaskExecutorOptions } from './executors/unity-task-executor';
export { UnityTaskExecutor } from './executors/unity-task-executor';
export {
  createConfiguredPromptInterpreter,
  ModelPromptInterpreter,
} from './model/prompt-interpreter';
export { PostgresGameSpecPersistence } from './persistence/postgres-game-spec';

function configuredStore(): PlatformStore {
  if (process.env.DATABASE_URL)
    return PostgresDomainRepository.fromEnvironment();
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL_REQUIRED');
  return new InMemoryPlatformStore();
}

function defaultAgentPolicy(run: Run): AgentKernelPolicy {
  return {
    allowedToolNames: ['model.game-spec.interpret', 'unity.task.execute'],
    allowedSafetyClasses: ['model_inference', 'engine_mutation'],
    budget: {
      maxSteps: 64,
      maxToolCalls: 64,
      maxRetriesPerAction: Math.min(1, Math.max(0, run.maxFixIterations)),
      deadlineMs: 60 * 60 * 1000,
    },
  };
}

function isRetryableUnityFailure(code: string): boolean {
  return /(?:TIMEOUT|TEMPORARY|UNAVAILABLE|CONNECTION|LEASE|BUSY)/i.test(code);
}

function configuredCheckpointService(store: PlatformStore):
  | {
      service: CheckpointService;
      sourceRevision: (run: Run) => Promise<string>;
    }
  | undefined {
  if (!(store instanceof PostgresDomainRepository)) return undefined;
  const repoPath = process.env.GAMERHUB_WORKSPACE_REPO_PATH;
  if (!repoPath) return undefined;
  const git = new GitCheckpointStore({
    repoPath,
    metadataStore: new PostgresCheckpointMetadataStore(store.pool),
  });
  return {
    service: git,
    sourceRevision: async () => git.head(),
  };
}

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.GAMERHUB_START_WORKER === '1'
) {
  void startConfiguredWorker().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.slice(0, 1000));
    process.exitCode = 1;
  });
}
