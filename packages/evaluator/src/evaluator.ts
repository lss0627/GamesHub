import { randomUUID } from 'node:crypto';
import { parseEvaluationReport } from '@gamerhub/contracts';
import type { CompiledAssertion } from './assertion-compiler';

export interface EvidenceObservation {
  assertionId: string;
  status: 'passed' | 'failed' | 'inconclusive' | 'infra_error';
  summary?: string;
  actual?: unknown;
  evidenceIds?: string[];
}

export function evaluateEvidence(input: {
  runId: string;
  playtestRunId: string;
  gameSpecVersionId: string;
  assertions: CompiledAssertion[];
  evidence: EvidenceObservation[];
}) {
  const observations = new Map(
    input.evidence.map((item) => [item.assertionId, item]),
  );
  const assertionResults = input.assertions.map((assertion) => {
    const observation = observations.get(assertion.assertionId);
    const status =
      observation?.status === 'passed' && !observation.evidenceIds?.length
        ? 'inconclusive'
        : (observation?.status ?? 'inconclusive');
    return {
      assertion_id: assertion.assertionId,
      status,
      evidence_ids: observation?.evidenceIds ?? [],
      ...(observation?.summary ? { summary: observation.summary } : {}),
    };
  });
  const issues = input.assertions.flatMap((assertion) => {
    const observation = observations.get(assertion.assertionId);
    if (
      !observation ||
      (observation.status !== 'failed' && observation.status !== 'infra_error')
    )
      return [];
    const issue = {
      id: `issue-${assertion.assertionId}`,
      assertion_id: assertion.assertionId,
      severity: assertion.severity,
      category: assertion.capability.includes('score')
        ? ('progression' as const)
        : assertion.capability.includes('input')
          ? ('input' as const)
          : ('runtime' as const),
      description:
        observation.summary ??
        `Assertion ${assertion.assertionId} did not pass`,
      expected: assertion.expected,
      actual: observation.actual ?? null,
      evidence_ids: observation.evidenceIds ?? [],
      affected_capabilities: [assertion.capability],
      retryable: observation.status === 'infra_error',
    };
    return [issue];
  });
  const status = assertionResults.some((result) => result.status === 'failed')
    ? 'failed'
    : assertionResults.length > 0 &&
        assertionResults.every((result) => result.status === 'passed')
      ? 'passed'
      : 'inconclusive';
  return parseEvaluationReport({
    schema_version: '1.0.0',
    report_id: randomUUID(),
    run_id: input.runId,
    playtest_run_id: input.playtestRunId,
    game_spec_version_id: input.gameSpecVersionId,
    status,
    assertion_results: assertionResults,
    issues,
  });
}
