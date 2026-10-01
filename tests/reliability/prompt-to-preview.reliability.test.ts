import {
  loadReleasePreviewEvidence,
  runPromptToPreviewReliability,
  validateReleasePreviewEvidence,
} from '@gamerhub/observability';
import { describe, expect, it } from 'vitest';

describe('prompt-to-preview reliability', () => {
  it('uses isolated project/spec/build identifiers and tracks the 15 minute bound', async () => {
    const result = await runPromptToPreviewReliability(10);
    expect(result.runs).toBe(10);
    expect(result.successRate).toBeGreaterThanOrEqual(0.8);
    expect(result.reusedArtifacts).toBe(0);
    expect(result.withinFifteenMinutes).toBe(10);
  });

  it('rejects fixture provenance even when an evidence file claims Unity execution', () => {
    const observations = Array.from({ length: 10 }, (_, index) => ({
      runId: `run-${index}`,
      projectId: `project-${index}`,
      specVersionId: `spec-${index}`,
      buildId: `build-${index}`,
      executionMode: 'unity' as const,
      startedAt: '2026-08-31T00:00:00.000Z',
      finishedAt: '2026-08-31T00:01:00.000Z',
      durationMs: 60_000,
      gameplayVerdict: 'passed' as const,
      buildProvenance: {
        source: 'offline-fixture',
        fixture: true,
      },
    }));
    expect(() => validateReleasePreviewEvidence(observations)).toThrow(
      'RELEASE_REAL_PROVENANCE_REQUIRED',
    );
  });

  const releaseEvidence = process.env.GAMERHUB_RELEASE_PREVIEW_EVIDENCE;
  if (process.env.GAMERHUB_REQUIRE_E2E === '1' && !releaseEvidence)
    throw new Error('GAMERHUB_RELEASE_PREVIEW_EVIDENCE_REQUIRED');
  it.skipIf(!releaseEvidence)(
    'accepts only measured real-Unity release evidence',
    () => {
      if (!releaseEvidence)
        throw new Error('GAMERHUB_RELEASE_PREVIEW_EVIDENCE_REQUIRED');
      const report = loadReleasePreviewEvidence(releaseEvidence);
      expect(report.runs).toBeGreaterThanOrEqual(10);
      expect(report.executionModes).toEqual(['unity']);
      expect(report.reusedArtifacts).toBe(0);
    },
  );
});
