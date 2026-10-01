import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface PreviewRunObservation {
  runId: string;
  projectId: string;
  specVersionId: string;
  buildId: string;
  executionMode: 'unity' | 'fixture';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  gameplayVerdict: 'passed' | 'failed' | 'inconclusive';
  buildProvenance: Record<string, unknown>;
  previewUrl?: string;
}

export interface PreviewRunExecutor {
  execute(input: {
    runId: string;
    projectId: string;
    specVersionId: string;
  }): Promise<
    Omit<
      PreviewRunObservation,
      | 'runId'
      | 'projectId'
      | 'specVersionId'
      | 'startedAt'
      | 'finishedAt'
      | 'durationMs'
    >
  >;
}

export interface ReliabilityReport {
  runs: number;
  successRate: number;
  reusedArtifacts: number;
  withinFifteenMinutes: number;
  runIds: string[];
  executionModes: Array<'unity' | 'fixture'>;
  observations: PreviewRunObservation[];
}

export async function measurePromptToPreviewRuns(
  runs: number,
  executor: PreviewRunExecutor,
  options: { requireUnity?: boolean } = {},
): Promise<ReliabilityReport> {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('RUN_COUNT_INVALID');
  const observations: PreviewRunObservation[] = [];
  for (let index = 0; index < runs; index += 1) {
    const runId = randomUUID();
    const projectId = randomUUID();
    const specVersionId = randomUUID();
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = await executor.execute({ runId, projectId, specVersionId });
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    if (options.requireUnity && result.executionMode !== 'unity')
      throw new Error('UNITY_EXECUTION_REQUIRED');
    observations.push({
      runId,
      projectId,
      specVersionId,
      ...result,
      startedAt,
      finishedAt,
      durationMs,
    });
  }
  const buildIds = new Set(observations.map((item) => item.buildId));
  const runIds = observations.map((item) => item.runId);
  return {
    runs,
    successRate:
      observations.filter((item) => item.gameplayVerdict === 'passed').length /
      runs,
    reusedArtifacts: runs - buildIds.size,
    withinFifteenMinutes: observations.filter(
      (item) => item.durationMs <= 15 * 60 * 1000,
    ).length,
    runIds,
    executionModes: [
      ...new Set(observations.map((item) => item.executionMode)),
    ],
    observations,
  };
}

export function validateReleasePreviewEvidence(
  observations: PreviewRunObservation[],
): ReliabilityReport {
  if (observations.length < 10) throw new Error('RELEASE_RUN_COUNT_INVALID');
  const runIds = observations.map((item) => item.runId);
  const projectIds = observations.map((item) => item.projectId);
  const specIds = observations.map((item) => item.specVersionId);
  const buildIds = new Set(observations.map((item) => item.buildId));
  if (new Set(runIds).size !== runIds.length)
    throw new Error('RELEASE_RUN_IDS_NOT_UNIQUE');
  if (new Set(projectIds).size !== projectIds.length)
    throw new Error('RELEASE_PROJECT_IDS_NOT_ISOLATED');
  if (new Set(specIds).size !== specIds.length)
    throw new Error('RELEASE_SPEC_IDS_NOT_ISOLATED');
  if (buildIds.size !== observations.length)
    throw new Error('RELEASE_BUILD_IDS_NOT_ISOLATED');
  if (observations.some((item) => item.executionMode !== 'unity'))
    throw new Error('UNITY_EXECUTION_REQUIRED');
  if (
    observations.some(
      (item) =>
        !Number.isFinite(item.durationMs) ||
        item.durationMs < 0 ||
        !['passed', 'failed', 'inconclusive'].includes(item.gameplayVerdict),
    )
  )
    throw new Error('RELEASE_TIMING_OR_VERDICT_INVALID');
  if (
    observations.some(
      (item) =>
        item.buildProvenance?.fixture === true ||
        (typeof item.buildProvenance?.source === 'string' &&
          /fixture|offline/i.test(item.buildProvenance.source)),
    )
  )
    throw new Error('RELEASE_REAL_PROVENANCE_REQUIRED');
  if (
    observations.some(
      (item) => !item.buildProvenance || !item.finishedAt || !item.startedAt,
    )
  )
    throw new Error('RELEASE_PROVENANCE_MISSING');
  return {
    runs: observations.length,
    successRate:
      observations.filter((item) => item.gameplayVerdict === 'passed').length /
      observations.length,
    reusedArtifacts: observations.length - buildIds.size,
    withinFifteenMinutes: observations.filter(
      (item) => item.durationMs <= 15 * 60 * 1000,
    ).length,
    runIds,
    executionModes: ['unity'],
    observations: observations.map((item) => ({
      ...item,
      projectId: item.projectId,
      specVersionId: item.specVersionId,
    })),
  };
}

export function loadReleasePreviewEvidence(path: string): ReliabilityReport {
  if (!existsSync(path)) throw new Error('RELEASE_EVIDENCE_NOT_FOUND');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('RELEASE_EVIDENCE_INVALID');
  return validateReleasePreviewEvidence(parsed as PreviewRunObservation[]);
}

export async function runPromptToPreviewReliability(
  runs: number,
  options: { executor?: PreviewRunExecutor; requireUnity?: boolean } = {},
): Promise<ReliabilityReport> {
  const executor = options.executor ?? {
    async execute(input: {
      runId: string;
      projectId: string;
      specVersionId: string;
    }) {
      // Explicitly labelled offline fallback for unit tests. Production and
      // release evidence must inject a Unity-backed executor and set requireUnity.
      return {
        buildId: `fixture-build-${input.runId}`,
        executionMode: 'fixture' as const,
        gameplayVerdict: 'passed' as const,
        buildProvenance: { source: 'offline-fixture', runId: input.runId },
      };
    },
  };
  return measurePromptToPreviewRuns(runs, executor, {
    requireUnity: options.requireUnity ?? Boolean(options.executor),
  });
}
