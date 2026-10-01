import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface AcceptanceEvidence {
  provenance: {
    fixture: false;
    executionMode: 'unity';
    capturedAt: string;
    source: string;
  };
  noviceCompletion: { denominator: number; numerator: number };
  localChange: {
    denominator: number;
    withinFiveMinutes: number;
    regressionPassed: number;
  };
  rollback: { denominator: number; withinSixtySeconds: number };
  isolation: { denominator: number; passed: number };
  traceability: { denominator: number; complete: number };
  browserMatrix: { denominator: number; passed: number };
}

function readEvidence(): AcceptanceEvidence {
  const path = process.env.GAMERHUB_ACCEPTANCE_EVIDENCE_FILE;
  if (!path || !existsSync(path))
    throw new Error('ACCEPTANCE_EVIDENCE_FILE_REQUIRED');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new Error('ACCEPTANCE_EVIDENCE_INVALID');
  const value = parsed as Record<string, unknown>;
  const provenance = value.provenance;
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    (provenance as Record<string, unknown>).fixture !== false ||
    (provenance as Record<string, unknown>).executionMode !== 'unity' ||
    typeof (provenance as Record<string, unknown>).capturedAt !== 'string' ||
    typeof (provenance as Record<string, unknown>).source !== 'string' ||
    !String((provenance as Record<string, unknown>).source).trim() ||
    !Number.isFinite(
      Date.parse(String((provenance as Record<string, unknown>).capturedAt)),
    ) ||
    /fixture|offline/i.test(
      String((provenance as Record<string, unknown>).source),
    )
  )
    throw new Error('ACCEPTANCE_NON_FIXTURE_PROVENANCE_REQUIRED');
  const metrics = [
    ['noviceCompletion', ['denominator', 'numerator']],
    ['localChange', ['denominator', 'withinFiveMinutes', 'regressionPassed']],
    ['rollback', ['denominator', 'withinSixtySeconds']],
    ['isolation', ['denominator', 'passed']],
    ['traceability', ['denominator', 'complete']],
    ['browserMatrix', ['denominator', 'passed']],
  ] as const;
  for (const [name, keys] of metrics) {
    const metric = value[name];
    if (!metric || typeof metric !== 'object')
      throw new Error('ACCEPTANCE_EVIDENCE_INVALID');
    const fields = metric as Record<string, unknown>;
    for (const key of keys)
      if (
        typeof fields[key] !== 'number' ||
        !Number.isInteger(fields[key]) ||
        fields[key] < 0
      )
        throw new Error('ACCEPTANCE_EVIDENCE_INVALID');
    const denominator = fields.denominator as number;
    for (const key of keys.slice(1))
      if ((fields[key] as number) > denominator)
        throw new Error('ACCEPTANCE_EVIDENCE_INVALID');
  }
  return value as unknown as AcceptanceEvidence;
}

const required = process.env.GAMERHUB_REQUIRE_E2E === '1';
const acceptanceUrl = process.env.GAMERHUB_ACCEPTANCE_URL;

describe('non-fixture MVP success criteria', () => {
  if (required && !acceptanceUrl)
    throw new Error('GAMERHUB_ACCEPTANCE_URL_REQUIRED');

  it.skipIf(!acceptanceUrl)(
    'records denominators for every release criterion',
    async () => {
      const health = await fetch(`${acceptanceUrl}/health`);
      expect(health.ok).toBe(true);
      const evidence = readEvidence();
      for (const criterion of Object.values(evidence)) {
        if (
          criterion &&
          typeof criterion === 'object' &&
          'denominator' in criterion
        )
          expect(criterion.denominator).toBeGreaterThan(0);
      }
      expect(
        evidence.noviceCompletion.numerator /
          evidence.noviceCompletion.denominator,
      ).toBeGreaterThanOrEqual(0.85);
      expect(
        evidence.localChange.withinFiveMinutes /
          evidence.localChange.denominator,
      ).toBeGreaterThanOrEqual(0.9);
      expect(
        evidence.localChange.regressionPassed /
          evidence.localChange.denominator,
      ).toBeGreaterThanOrEqual(0.95);
      expect(
        evidence.rollback.withinSixtySeconds / evidence.rollback.denominator,
      ).toBe(1);
      expect(evidence.isolation.passed / evidence.isolation.denominator).toBe(
        1,
      );
      expect(
        evidence.traceability.complete / evidence.traceability.denominator,
      ).toBeGreaterThanOrEqual(0.95);
      expect(
        evidence.browserMatrix.passed / evidence.browserMatrix.denominator,
      ).toBeGreaterThanOrEqual(0.95);
      expect(evidence.browserMatrix.denominator).toBeGreaterThanOrEqual(3);
    },
  );
});
