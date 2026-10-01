import type { PostgresDomainRepository } from '@gamerhub/domain';
import type {
  EngineAdapter,
  EngineCommandResult,
  EngineExecutionContext,
  EngineTestResult,
} from '@gamerhub/engine-adapter';
import type { DevelopmentCriterion, PlannerTask } from '@gamerhub/game-planner';
import {
  createRunnerSkillRegistry,
  type GameSkillRegistry,
  type SkillExecuteContext,
} from '@gamerhub/game-skills';
import {
  type EvidenceStore,
  executeActionTimelineWithEvidence,
  type PlaytestAction,
  type PlaytestProtocolClient,
} from '@gamerhub/playtest';
import type {
  CreateGameEvidence,
  CreateGameTaskResult,
  TestVerification,
} from '../workflows/create-game';

export interface UnityTaskExecutorOptions {
  adapter: EngineAdapter;
  skillRegistry?: GameSkillRegistry;
  projectPath: string;
  testSuites?: Array<{
    mode: 'editmode' | 'playmode';
    testFilter: string;
    minimumPassed: number;
    criteria?: DevelopmentCriterion[];
    development?: boolean;
  }>;
  checkpointRef?: string;
  probeClient?: PlaytestProtocolClient;
  playtestActions?: PlaytestAction[];
  runPlaytest?: (input: { task: PlannerTask; runId: string }) => Promise<{
    passed: boolean;
    evidence: CreateGameEvidence[];
  }>;
  evaluate?: (input: {
    task: PlannerTask;
    evidence: CreateGameEvidence[];
  }) => Promise<{
    passed: boolean;
    evidence: CreateGameEvidence[];
    reportKey?: string;
    evaluatorVersion?: string;
  }>;
  evidenceStore?: EvidenceStore;
  parameterValues?: Record<string, string>;
  /** Sprites loaded by the runtime through Resources, without prefab rebinding. */
  resourceAssetPaths?: string[];
  durableStore?: PostgresDomainRepository;
  projectId?: string;
  specVersionId?: string;
  checkpointId?: string;
  packageLockHash?: string;
  templateVersion?: string;
  rollbackAsset?: () => Promise<void>;
  stageAsset?: (input: {
    runId: string;
    task: PlannerTask;
    targetPath: string;
  }) => Promise<void>;
  onAssetImported?: (input: {
    runId: string;
    task: PlannerTask;
    targetPath: string;
  }) => Promise<void>;
  onAssetImportFailed?: (input: {
    runId: string;
    task: PlannerTask;
    targetPath: string;
  }) => Promise<void>;
}

const skillByTask: Record<string, string> = {
  'scene-create': 'create_runner_project',
  'player-create': 'create_platformer_player',
  'obstacles-create': 'create_obstacle_system',
  'coins-create': 'create_coin_system',
  'game-over-create': 'create_game_over',
};

const engineMutationCapabilities = new Set([
  'scene.create',
  'game_object.create',
  'prefab.create',
  'script.create',
  'asset.import',
  'ui.create',
  'component.set_property',
]);

// Adapter diagnostic metadata can contain process output and local paths.
// Expose the stable failure code and a known public explanation only.
const publicEngineMessages: Record<string, string> = {
  ENGINE_TIMEOUT: 'Unity batchmode exceeded its deadline',
  ENGINE_PROCESS_FAILED: 'Unity process exited with a failure',
  UNITY_TEST_FAILED: 'Unity Test Framework reported a failure',
  UNITY_TEST_RESULTS_MISSING:
    'Unity Test Framework did not produce a results file',
  UNITY_CONNECTION_UNAVAILABLE: 'Unity bridge is temporarily unavailable',
};

function engineFailure(
  result: EngineCommandResult,
  fallbackCode: string,
  fallbackMessage: string,
): NonNullable<CreateGameTaskResult['error']> {
  const diagnostic = result.errors[0];
  const code =
    diagnostic && /^[A-Z][A-Z0-9_]{0,79}$/.test(diagnostic.code)
      ? diagnostic.code
      : fallbackCode;
  return {
    code,
    message: publicEngineMessages[code] ?? fallbackMessage,
    retryable: result.retryable,
  };
}

function caughtFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): NonNullable<CreateGameTaskResult['error']> {
  const value =
    error && typeof error === 'object'
      ? (error as { code?: unknown; message?: unknown; retryable?: unknown })
      : {};
  const candidate = value.code ?? value.message;
  const code =
    typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate)
      ? candidate
      : fallbackCode;
  return {
    code,
    message: publicEngineMessages[code] ?? fallbackMessage,
    ...(typeof value.retryable === 'boolean'
      ? { retryable: value.retryable }
      : {}),
  };
}

function resultEvidence(
  task: PlannerTask,
  result: EngineCommandResult,
  type: string,
): CreateGameEvidence {
  const report = (result.output as Record<string, unknown> | undefined)
    ?.testReport as { contentHash?: string } | undefined;
  const immutableContentHash =
    (type === 'test' ? report?.contentHash : undefined) ??
    (result as EngineCommandResult & { contentHash?: string }).contentHash;
  return {
    type,
    reference: task.validation_method.reference,
    ...(immutableContentHash
      ? { contentHash: immutableContentHash }
      : result.projectRevision
        ? { contentHash: result.projectRevision }
        : {}),
  };
}

function verifyTests(
  result: EngineTestResult,
  suite: string,
  criteria?: DevelopmentCriterion[],
  development = false,
): TestVerification {
  const output = result.output as Record<string, unknown> | undefined;
  const report = output?.testReport as { contentHash?: unknown } | undefined;
  const reportHash =
    typeof report?.contentHash === 'string' &&
    /^sha256-[a-f0-9]{64}$/.test(report.contentHash)
      ? report.contentHash
      : undefined;
  const rawCases = output?.testCases;
  const cases = Array.isArray(rawCases)
    ? (rawCases as Array<{ fullName?: unknown; result?: unknown }>)
    : [];
  return {
    suite,
    mode: criteria?.length ? 'indexed' : development ? 'legacy' : 'baseline',
    passed: result.passed,
    failed: result.failed,
    ...(reportHash ? { reportHash } : {}),
    criteria: (criteria ?? []).map((criterion) => {
      const prefix = `${suite}.${criterion.testPrefix}`;
      const matches = cases.filter(
        (item) =>
          typeof item.fullName === 'string' &&
          (item.fullName === prefix ||
            item.fullName.startsWith(`${prefix}_`) ||
            item.fullName.startsWith(`${prefix}(`)),
      );
      return {
        id: criterion.id,
        description: criterion.description,
        caseCount: matches.length,
        status:
          !matches.length || !reportHash
            ? 'missing'
            : matches.every((item) => item.result === 'Passed')
              ? 'passed'
              : 'failed',
      };
    }),
  };
}

export class UnityTaskExecutor {
  private readonly skills: GameSkillRegistry;
  private capabilities: string[] | undefined;
  private readonly evidenceByRun = new Map<string, CreateGameEvidence[]>();
  private readonly playtestRunIds = new Map<string, string>();

  constructor(private readonly options: UnityTaskExecutorOptions) {
    this.skills = options.skillRegistry ?? createRunnerSkillRegistry();
  }

  restoreResult(
    task: PlannerTask,
    runId: string,
    result: CreateGameTaskResult,
  ): void {
    if (task.type !== 'playtest' || result.status !== 'completed') return;
    if (this.options.durableStore && !result.durablePlaytestRunId)
      throw Object.assign(
        new Error('Previous playtest has no recovery identity'),
        {
          code: 'PLAYTEST_RECOVERY_CONTEXT_REQUIRED',
        },
      );
    this.evidenceByRun.set(runId, structuredClone(result.evidence));
    if (result.durablePlaytestRunId)
      this.playtestRunIds.set(runId, result.durablePlaytestRunId);
  }

  async execute(
    task: PlannerTask,
    runId: string,
    trace?: { traceId: string; spanId: string },
  ): Promise<CreateGameTaskResult> {
    try {
      const capabilities = await this.getCapabilities();
      const context: EngineExecutionContext = {
        runId,
        taskId: task.id,
        ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
        workspaceRoot: this.options.projectPath,
        capabilities,
        ...(this.options.checkpointRef
          ? { checkpointRef: this.options.checkpointRef }
          : {}),
      };
      if (task.capabilities.includes('gameplay.develop')) {
        const compile = await this.options.adapter.compile(
          { projectRef: this.options.projectPath },
          context,
        );
        if (compile.status !== 'succeeded' || compile.errors.length)
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: engineFailure(
              compile,
              'DEVELOPMENT_COMPILE_FAILED',
              '新增机制未通过编译',
            ),
          };
        const tests = await this.options.adapter.runTests(
          {
            projectRef: this.options.projectPath,
            mode: 'playmode',
            testFilter: task.validation_method.reference,
          },
          context,
        );
        const testsPassed =
          tests.status === 'succeeded' &&
          tests.failed === 0 &&
          tests.passed >= 2;
        const verification = verifyTests(
          tests,
          task.validation_method.reference,
          task.validation_method.criteria,
          true,
        );
        const missing = verification.criteria.filter(
          (item) => item.status !== 'passed',
        );
        const passed = testsPassed && missing.length === 0;
        return {
          taskId: task.id,
          status: passed ? 'completed' : 'failed',
          verification: [verification],
          evidence: passed
            ? [
                resultEvidence(task, compile, 'engine'),
                resultEvidence(task, tests, 'test'),
              ]
            : [],
          ...(passed
            ? {}
            : {
                error: {
                  code: testsPassed
                    ? 'DEVELOPMENT_ACCEPTANCE_REQUIRED'
                    : 'DEVELOPMENT_TESTS_REQUIRED',
                  message: testsPassed
                    ? `需求缺少通过的当前测试：${missing.map((item) => item.id).join(', ')}`
                    : '新增机制需要至少两项通过的真实行为测试',
                },
              }),
        };
      }
      const skillId =
        skillByTask[task.id] ??
        (task.type === 'asset' ? 'replace_character_asset' : undefined);
      if (skillId) {
        const skill = this.skills.get(skillId);
        const plan = await skill.plan(
          {},
          {
            engineType: 'unity',
            currentRevision: context.checkpointRef ?? 'unknown',
            capabilities,
            workspaceRoot: this.options.projectPath,
          },
        );
        const engineEvidence: CreateGameEvidence[] = [];
        const assetHookInput = {
          runId,
          task,
          targetPath: task.related_files[0] ?? 'Assets/Game/Art/Player.png',
        };
        const markAssetImportFailed = async (): Promise<void> => {
          if (skillId === 'replace_character_asset')
            await this.options.onAssetImportFailed?.(assetHookInput);
        };
        const skillContext: SkillExecuteContext = {
          expectedRevision: plan.expectedRevision,
          ...(context.checkpointRef
            ? { checkpointRef: context.checkpointRef }
            : {}),
        };
        if (skillId === 'replace_character_asset') {
          skillContext.importAsset = async () => {
            await this.options.stageAsset?.(assetHookInput);
            const paths = this.options.resourceAssetPaths ?? [
              assetHookInput.targetPath,
            ];
            for (const path of paths) {
              const result = await this.options.adapter.execute(
                {
                  commandId: `${runId}-${task.id}-asset-import-${Date.now()}`,
                  capability: 'asset.import',
                  safetyClass: 'project_write',
                  projectRef: this.options.projectPath,
                  arguments: { path },
                  timeoutMs: 20 * 60 * 1000,
                },
                context,
              );
              if (result.status !== 'succeeded')
                throw new Error('UNITY_ASSET_IMPORT_FAILED');
              engineEvidence.push(resultEvidence(task, result, 'engine'));
            }
            return {};
          };
          skillContext.compile = async () => {
            const result = await this.options.adapter.compile(
              { projectRef: this.options.projectPath },
              context,
            );
            engineEvidence.push(resultEvidence(task, result, 'compile'));
            return result.status === 'succeeded' && result.errors.length === 0;
          };
          skillContext.playtest = async () =>
            this.options.runPlaytest
              ? (await this.options.runPlaytest({ task, runId })).passed
              : this.runAssetPlaytest(runId);
          skillContext.rollback = async () => {
            if (!this.options.rollbackAsset)
              throw new Error('ASSET_ROLLBACK_HANDLER_REQUIRED');
            await this.options.rollbackAsset();
          };
        }
        const skillResult = await skill.execute(plan, skillContext);
        if (skillResult.status !== 'succeeded') {
          await markAssetImportFailed();
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            ...(skillResult.error ? { error: skillResult.error } : {}),
          };
        }
        for (const capability of task.capabilities) {
          if (!engineMutationCapabilities.has(capability)) continue;
          if (
            skillId === 'replace_character_asset' &&
            this.options.resourceAssetPaths &&
            capability === 'component.set_property'
          )
            continue;
          if (
            skillId === 'replace_character_asset' &&
            capability === 'asset.import'
          )
            continue;
          const result = await this.options.adapter.execute(
            {
              commandId: `${runId}-${task.id}-${capability}-${Date.now()}`,
              capability,
              safetyClass: 'project_write',
              projectRef: this.options.projectPath,
              arguments: this.argumentsForCapability(task, capability),
              timeoutMs: 20 * 60 * 1000,
            },
            context,
          );
          if (result.status !== 'succeeded') {
            await markAssetImportFailed();
            return {
              taskId: task.id,
              status: result.status === 'cancelled' ? 'cancelled' : 'failed',
              evidence: [],
              error: engineFailure(
                result,
                'UNITY_SKILL_OPERATION_FAILED',
                `Unity operation ${capability} failed`,
              ),
            };
          }
          engineEvidence.push(resultEvidence(task, result, 'engine'));
        }
        const skillValidation = await skill.validate(
          {
            ...skillResult,
            evidence: [
              ...skillResult.evidence,
              ...engineEvidence.map((item) => ({
                type: item.type,
                reference: item.reference,
              })),
            ],
          },
          { requiredEvidence: [task.validation_method.reference] },
        );
        if (skillValidation.status !== 'passed') {
          await markAssetImportFailed();
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: {
              code: 'UNITY_SKILL_VALIDATION_FAILED',
              message:
                skillValidation.reasons?.join('; ') ??
                'Skill validation failed',
            },
          };
        }
        try {
          if (skillId === 'replace_character_asset')
            await this.options.onAssetImported?.(assetHookInput);
        } catch (error) {
          await skillContext.rollback?.().catch(() => undefined);
          await markAssetImportFailed().catch(() => undefined);
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: caughtFailure(
              error,
              'ASSET_IMPORT_COMMIT_FAILED',
              'Asset import commit failed',
            ),
          };
        }
        return {
          taskId: task.id,
          status: 'completed',
          evidence: [
            ...skillResult.evidence.map((item) => ({
              type: 'engine',
              reference: item.reference,
            })),
            ...engineEvidence,
          ],
        };
      }
      if (task.type === 'spec')
        return {
          taskId: task.id,
          status: 'completed',
          evidence: [
            { type: 'schema', reference: task.validation_method.reference },
          ],
        };
      if (task.type === 'test') {
        const tests = [];
        const suites: Array<{
          mode: 'editmode' | 'playmode';
          minimumPassed: number;
          testFilter?: string;
          criteria?: DevelopmentCriterion[];
          development?: boolean;
        }> = this.options.testSuites ?? [
          { mode: 'editmode' as const, minimumPassed: 1 },
          { mode: 'playmode' as const, minimumPassed: 1 },
        ];
        for (const suite of suites)
          tests.push(
            await this.options.adapter.runTests(
              {
                projectRef: this.options.projectPath,
                mode: suite.mode,
                ...(suite.testFilter ? { testFilter: suite.testFilter } : {}),
              },
              context,
            ),
          );
        const verification = tests.map((item, index) =>
          verifyTests(
            item,
            suites[index]?.testFilter ?? suites[index]?.mode ?? 'Unity',
            suites[index]?.criteria,
            suites[index]?.development,
          ),
        );
        const failedIndex = tests.findIndex(
          (item, index) =>
            item.status !== 'succeeded' ||
            item.failed > 0 ||
            item.passed < (suites[index]?.minimumPassed ?? 1) ||
            verification[index]?.criteria.some(
              (criterion) => criterion.status !== 'passed',
            ),
        );
        const failed = failedIndex >= 0;
        return {
          taskId: task.id,
          status: failed ? 'failed' : 'completed',
          verification,
          evidence: failed
            ? []
            : tests.map((item) => resultEvidence(task, item, 'test')),
          ...(failed
            ? {
                error: verification[failedIndex]?.criteria.some(
                  (criterion) => criterion.status !== 'passed',
                )
                  ? {
                      code: 'DEVELOPMENT_ACCEPTANCE_REQUIRED',
                      message: `需求回归未通过：${verification[
                        failedIndex
                      ]?.criteria
                        .filter((criterion) => criterion.status !== 'passed')
                        .map((criterion) => criterion.id)
                        .join(', ')}`,
                    }
                  : engineFailure(
                      tests[failedIndex] as EngineCommandResult,
                      'UNITY_TEST_FAILED',
                      'Unity tests failed',
                    ),
              }
            : {}),
        };
      }
      if (task.type === 'playtest') {
        if (this.options.runPlaytest) {
          const durablePlaytestRunId = this.options.durableStore
            ? await this.createDurablePlaytestRun(
                runId,
                [],
                'local-unity-playmode',
              )
            : undefined;
          let playtest: Awaited<
            ReturnType<NonNullable<UnityTaskExecutorOptions['runPlaytest']>>
          >;
          try {
            playtest = await this.options.runPlaytest({ task, runId });
          } catch (error) {
            if (this.options.durableStore && durablePlaytestRunId)
              await this.options.durableStore.updatePlaytestRun(
                durablePlaytestRunId,
                'failed',
              );
            throw error;
          }
          if (this.options.durableStore && durablePlaytestRunId) {
            try {
              for (const [index, item] of playtest.evidence.entries()) {
                if (!item.contentHash)
                  throw new Error('DURABLE_PLAYTEST_EVIDENCE_HASH_REQUIRED');
                await this.options.durableStore.savePlaytestEvidence({
                  playtestRunId: durablePlaytestRunId,
                  assertionId: task.validation_method.reference,
                  kind: item.type,
                  sequence: index + 1,
                  timestampMs: index,
                  summary: item.reference,
                  payload: { reference: item.reference },
                  contentHash: item.contentHash,
                });
              }
              await this.options.durableStore.updatePlaytestRun(
                durablePlaytestRunId,
                playtest.passed ? 'passed' : 'failed',
              );
            } catch (error) {
              await this.options.durableStore.updatePlaytestRun(
                durablePlaytestRunId,
                'failed',
              );
              throw error;
            }
          }
          this.evidenceByRun.set(runId, playtest.evidence);
          return {
            taskId: task.id,
            status: playtest.passed ? 'completed' : 'failed',
            evidence: playtest.evidence,
            ...(durablePlaytestRunId ? { durablePlaytestRunId } : {}),
            ...(playtest.passed
              ? {}
              : {
                  error: {
                    code: 'PLAYTEST_FAILED',
                    message: 'Unity local playtest validation failed',
                  },
                }),
          };
        }
        if (!this.options.probeClient)
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: {
              code: 'PROBE_REQUIRED',
              message: 'A real Playtest Probe is required',
            },
          };
        if (!this.options.checkpointRef || !this.options.specVersionId)
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: {
              code: 'PROBE_CONTEXT_REQUIRED',
              message:
                'Playtest Probe requires the current project revision and Game Spec version',
            },
          };
        await this.options.probeClient.handshake({
          protocol_version: '1.0.0',
          project_revision: this.options.checkpointRef,
          game_spec_version: this.options.specVersionId,
          run_id: runId,
          seed: 42,
          fixed_delta_time_ms: 20,
        });
        const durablePlaytestRunId = this.options.durableStore
          ? await this.createDurablePlaytestRun(
              runId,
              this.options.playtestActions ?? [],
            )
          : undefined;
        let cycle: Awaited<
          ReturnType<typeof executeActionTimelineWithEvidence>
        >;
        try {
          cycle = await executeActionTimelineWithEvidence(
            this.options.probeClient,
            `playtest-${runId}`,
            this.options.playtestActions ?? [
              { command: 'input.jump' },
              { command: 'time.advance', arguments: { duration_ms: 1000 } },
              { command: 'state.player' },
            ],
            this.options.evidenceStore
              ? { evidenceStore: this.options.evidenceStore }
              : {},
          );
        } finally {
          await this.options.probeClient.close().catch(() => undefined);
        }
        const evidence = cycle.evidence.map((item) => ({
          type: 'playtest',
          reference: item.contentHash,
        }));
        if (this.options.durableStore && durablePlaytestRunId) {
          for (const item of cycle.evidence)
            await this.options.durableStore.savePlaytestEvidence({
              playtestRunId: durablePlaytestRunId,
              assertionId: item.assertionId ?? 'probe-state',
              kind: item.kind,
              sequence: item.sequence,
              timestampMs: item.timestampMs,
              summary: item.summary,
              payload: item.payload,
              contentHash: item.contentHash,
            });
          await this.options.durableStore.updatePlaytestRun(
            durablePlaytestRunId,
            cycle.responses.every((response) => response.status === 'ok')
              ? 'passed'
              : 'failed',
          );
        }
        this.evidenceByRun.set(runId, evidence);
        return {
          taskId: task.id,
          status: cycle.responses.every((response) => response.status === 'ok')
            ? 'completed'
            : 'failed',
          evidence,
          ...(durablePlaytestRunId ? { durablePlaytestRunId } : {}),
          ...(cycle.responses.every((response) => response.status === 'ok')
            ? {}
            : {
                error: {
                  code: 'PLAYTEST_FAILED',
                  message: 'Unity Playtest Probe reported a failed action',
                },
              }),
        };
      }
      if (task.type === 'evaluate') {
        const evaluation = await this.options.evaluate?.({
          task,
          evidence: this.evidenceByRun.get(runId) ?? [],
        });
        if (!evaluation)
          return {
            taskId: task.id,
            status: 'failed',
            evidence: [],
            error: {
              code: 'EVALUATOR_REQUIRED',
              message: 'A real evaluator is required',
            },
          };
        if (this.options.durableStore) {
          const playtestRunId = this.playtestRunIds.get(runId);
          if (!playtestRunId || !this.options.specVersionId)
            return {
              taskId: task.id,
              status: 'failed',
              evidence: [],
              error: {
                code: 'DURABLE_EVALUATION_CONTEXT_REQUIRED',
                message:
                  'Durable evaluation requires a playtest run and spec version',
              },
            };
          if (!evaluation.reportKey)
            return {
              taskId: task.id,
              status: 'failed',
              evidence: [],
              error: {
                code: 'DURABLE_EVALUATION_REPORT_KEY_REQUIRED',
                message: 'Durable evaluation requires an immutable report key',
              },
            };
          await this.options.durableStore.saveEvaluationReport({
            runId,
            playtestRunId,
            gameSpecVersionId: this.options.specVersionId,
            evaluatorVersion:
              evaluation.evaluatorVersion ?? 'injected-evaluator',
            status: evaluation.passed ? 'passed' : 'failed',
            passedCount: evaluation.passed ? 1 : 0,
            failedCount: evaluation.passed ? 0 : 1,
            inconclusiveCount: 0,
            reportKey: evaluation.reportKey,
          });
        }
        return {
          taskId: task.id,
          status: evaluation.passed ? 'completed' : 'failed',
          evidence: evaluation.evidence,
          ...(evaluation.passed
            ? {}
            : {
                error: {
                  code: 'EVALUATION_FAILED',
                  message: 'Evaluation did not pass',
                },
              }),
        };
      }
      if (task.type === 'build') {
        const build = await this.options.adapter.buildWeb(
          {
            projectRef: this.options.projectPath,
            outputPath: `Builds/Web/${runId}`,
          },
          context,
        );
        if (this.options.durableStore && build.status === 'succeeded') {
          if (
            !this.options.projectId ||
            !this.options.specVersionId ||
            !this.options.checkpointId ||
            !this.options.packageLockHash
          )
            return {
              taskId: task.id,
              status: 'failed',
              evidence: [],
              error: {
                code: 'DURABLE_BUILD_CONTEXT_REQUIRED',
                message:
                  'Durable builds require project, spec, checkpoint and lock provenance',
              },
            };
          await this.options.durableStore.saveBuild({
            projectId: this.options.projectId,
            checkpointId: this.options.checkpointId,
            specVersionId: this.options.specVersionId,
            status: 'ready',
            engineVersion: build.provenance.engineVersion ?? '6000.0.80f1',
            adapterVersion: this.options.adapter.adapterVersion,
            templateVersion:
              this.options.templateVersion ?? 'runner-template-1.0.0',
            packageLockHash: this.options.packageLockHash,
            artifactKey: build.artifactPath,
            contentHash: build.contentHash,
          });
        }
        return {
          taskId: task.id,
          status: build.status === 'succeeded' ? 'completed' : 'failed',
          evidence:
            build.status === 'succeeded'
              ? [resultEvidence(task, build, 'build')]
              : [],
          ...(build.status === 'succeeded'
            ? {}
            : {
                error: engineFailure(
                  build,
                  'UNITY_BUILD_FAILED',
                  'Unity Web build failed',
                ),
              }),
        };
      }
      if (task.type === 'publish')
        return {
          taskId: task.id,
          status: 'completed',
          evidence: [
            {
              type: 'publish-intent',
              reference: task.validation_method.reference,
            },
          ],
        };
      const engineResult = await this.options.adapter.execute(
        {
          commandId: `${task.id}-${Date.now()}`,
          capability: task.capabilities[0] ?? 'scene.edit',
          safetyClass: 'project_write',
          projectRef: this.options.projectPath,
          arguments:
            task.id === 'parameter-update'
              ? {
                  assetPath: 'Assets/Game/Prefabs/Player.prefab',
                  value: this.options.parameterValues?.jump_height ?? '',
                }
              : {
                  path:
                    task.related_files[0] ?? 'Assets/Game/Scenes/Runner.unity',
                },
          timeoutMs: 20 * 60 * 1000,
        },
        context,
      );
      return {
        taskId: task.id,
        status:
          engineResult.status === 'succeeded'
            ? 'completed'
            : engineResult.status,
        evidence:
          engineResult.status === 'succeeded'
            ? [resultEvidence(task, engineResult, 'engine')]
            : [],
        ...(engineResult.status === 'succeeded'
          ? {}
          : {
              error: engineFailure(
                engineResult,
                'UNITY_TASK_FAILED',
                'Unity operation failed',
              ),
            }),
      };
    } catch (error) {
      return {
        taskId: task.id,
        status: 'failed',
        evidence: [],
        error: caughtFailure(error, 'UNITY_TASK_FAILED', 'Unity task failed'),
      };
    }
  }

  private async getCapabilities(): Promise<string[]> {
    if (!this.capabilities) {
      const result = await this.options.adapter.discoverCapabilities();
      this.capabilities = [...result.commands];
    }
    return [...this.capabilities];
  }

  private argumentsForCapability(
    task: PlannerTask,
    capability: string,
  ): Record<string, unknown> {
    const firstFile =
      task.related_files[0] ?? 'Assets/Game/Scenes/Runner.unity';
    switch (capability) {
      case 'scene.create':
        return { path: firstFile };
      case 'game_object.create':
        return { name: 'Player', scene: 'Assets/Game/Scenes/Runner.unity' };
      case 'prefab.create':
        return { path: firstFile };
      case 'script.create':
        return { path: firstFile };
      case 'asset.import':
        return { path: firstFile };
      case 'ui.create':
        return { path: firstFile };
      case 'component.set_property':
        if (task.id === 'player-create')
          return {
            assetPath: 'Assets/Game/Prefabs/Player.prefab',
            property: 'jumpVelocity',
            value: this.options.parameterValues?.jump_height ?? '3.5',
          };
        return {
          assetPath: firstFile,
          property: 'runner.configuration',
          value: 'configured',
        };
      default:
        return { path: firstFile };
    }
  }

  private async createDurablePlaytestRun(
    runId: string,
    actions: PlaytestAction[],
    mode = 'probe',
  ): Promise<string> {
    if (!this.options.durableStore || !this.options.projectId)
      throw new Error('DURABLE_PLAYTEST_CONTEXT_REQUIRED');
    const id = await this.options.durableStore.createPlaytestRun({
      runId,
      projectId: this.options.projectId,
      mode,
      seed: 0,
      fixedDeltaTimeMs: 16,
      status: 'running',
      actionPlan: { actions },
      environmentSnapshot: {
        engine: this.options.adapter.engineType,
        adapterVersion: this.options.adapter.adapterVersion,
      },
    });
    this.playtestRunIds.set(runId, id);
    return id;
  }

  private async runAssetPlaytest(runId: string): Promise<boolean> {
    if (
      !this.options.probeClient ||
      !this.options.checkpointRef ||
      !this.options.specVersionId
    )
      return false;
    await this.options.probeClient.handshake({
      protocol_version: '1.0.0',
      project_revision: this.options.checkpointRef,
      game_spec_version: this.options.specVersionId,
      run_id: runId,
      seed: 42,
      fixed_delta_time_ms: 20,
    });
    try {
      const cycle = await executeActionTimelineWithEvidence(
        this.options.probeClient,
        `asset-replacement-${runId}`,
        this.options.playtestActions ?? [
          { command: 'input.jump' },
          { command: 'time.advance', arguments: { duration_ms: 1000 } },
          { command: 'state.player' },
        ],
        this.options.evidenceStore
          ? { evidenceStore: this.options.evidenceStore }
          : {},
      );
      const evidence = cycle.evidence.map((item) => ({
        type: 'playtest',
        reference: item.contentHash,
      }));
      this.evidenceByRun.set(runId, [
        ...(this.evidenceByRun.get(runId) ?? []),
        ...evidence,
      ]);
      return cycle.responses.every((response) => response.status === 'ok');
    } finally {
      await this.options.probeClient.close().catch(() => undefined);
    }
  }
}
