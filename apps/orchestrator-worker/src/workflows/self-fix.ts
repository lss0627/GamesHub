export interface SelfFixIssue {
  id: string;
  assertionId: string;
  affectedCapabilities: string[];
}

export interface SelfFixResult {
  iterations: number;
  stopReason: 'resolved' | 'iteration_limit' | 'no_fix' | 'cancelled';
  targetedAssertions: string[];
  resolved: boolean;
}

export async function runSelfFixLoop(input: {
  maxIterations?: number;
  issues: SelfFixIssue[];
  executeFix: (issue: SelfFixIssue, iteration: number) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<SelfFixResult> {
  const limit = Math.min(5, Math.max(0, input.maxIterations ?? 5));
  const targetedAssertions = [
    ...new Set(input.issues.map((issue) => issue.assertionId)),
  ];
  if (input.issues.length === 0)
    return {
      iterations: 0,
      stopReason: 'no_fix',
      targetedAssertions,
      resolved: false,
    };
  let iterations = 0;
  for (const issue of input.issues) {
    while (iterations < limit) {
      if (input.signal?.aborted)
        return {
          iterations,
          stopReason: 'cancelled',
          targetedAssertions,
          resolved: false,
        };
      iterations += 1;
      if (await input.executeFix(issue, iterations))
        return {
          iterations,
          stopReason: 'resolved',
          targetedAssertions,
          resolved: true,
        };
    }
    if (iterations >= limit) break;
  }
  return {
    iterations,
    stopReason: limit > 0 ? 'iteration_limit' : 'no_fix',
    targetedAssertions,
    resolved: false,
  };
}

export interface ProbeEvaluationCycleResult {
  iterations: number;
  stopReason: SelfFixResult['stopReason'] | 'infra_error';
  resolved: boolean;
  targetedAssertions: string[];
  evidenceCount: number;
}

/** Runs probe actions, evaluates committed evidence, and only then retries a
 * bounded targeted fix. It is deliberately transport-agnostic so a licensed
 * Unity Probe can be used in production while tests inject a protocol client.
 */
export async function runProbeEvaluationFixLoop(input: {
  client: PlaytestProtocolClient;
  handshake: Parameters<PlaytestProtocolClient['handshake']>[0];
  actions: PlaytestAction[];
  maxIterations?: number;
  evaluate: (input: {
    iteration: number;
    evidence: PlaytestEvidence[];
  }) => Promise<{ passed: boolean; issues: SelfFixIssue[] }>;
  applyFix: (issue: SelfFixIssue, iteration: number) => Promise<boolean>;
  evidenceStore?: EvidenceStore;
  signal?: AbortSignal;
}): Promise<ProbeEvaluationCycleResult> {
  const limit = Math.min(5, Math.max(0, input.maxIterations ?? 5));
  const targeted = new Set<string>();
  let evidenceCount = 0;
  let iterations = 0;
  try {
    await input.client.handshake({
      ...input.handshake,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    for (let attempt = 0; attempt <= limit; attempt += 1) {
      if (input.signal?.aborted)
        return {
          iterations,
          stopReason: 'cancelled',
          resolved: false,
          targetedAssertions: [...targeted],
          evidenceCount,
        };
      const cycle = await executeActionTimelineWithEvidence(
        input.client,
        `playtest-${attempt}`,
        input.actions,
        {
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.evidenceStore
            ? { evidenceStore: input.evidenceStore }
            : {}),
        },
      );
      evidenceCount += cycle.evidence.length;
      const evaluation = await input.evaluate({
        iteration: attempt,
        evidence: cycle.evidence,
      });
      evaluation.issues.forEach((issue) => {
        targeted.add(issue.assertionId);
      });
      if (evaluation.passed)
        return {
          iterations,
          stopReason: 'resolved',
          resolved: true,
          targetedAssertions: [...targeted],
          evidenceCount,
        };
      if (attempt >= limit)
        return {
          iterations,
          stopReason: 'iteration_limit',
          resolved: false,
          targetedAssertions: [...targeted],
          evidenceCount,
        };
      const issue = evaluation.issues[0];
      if (!issue)
        return {
          iterations,
          stopReason: 'no_fix',
          resolved: false,
          targetedAssertions: [...targeted],
          evidenceCount,
        };
      iterations += 1;
      if (!(await input.applyFix(issue, iterations)))
        return {
          iterations,
          stopReason: 'no_fix',
          resolved: false,
          targetedAssertions: [...targeted],
          evidenceCount,
        };
    }
  } catch (error) {
    return {
      iterations,
      stopReason:
        classifyPlaytestFailure(error) === 'cancelled'
          ? 'cancelled'
          : 'infra_error',
      resolved: false,
      targetedAssertions: [...targeted],
      evidenceCount,
    };
  } finally {
    await input.client.close().catch(() => undefined);
  }
  return {
    iterations,
    stopReason: 'iteration_limit',
    resolved: false,
    targetedAssertions: [...targeted],
    evidenceCount,
  };
}

import type { PlaytestEvidence } from '@gamerhub/playtest';
import {
  classifyPlaytestFailure,
  type EvidenceStore,
  executeActionTimelineWithEvidence,
  type PlaytestAction,
  type PlaytestProtocolClient,
} from '@gamerhub/playtest';
