import type { GameSpec } from '@gamerhub/game-spec';

export interface CompiledAssertion {
  assertionId: string;
  capability: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  preconditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  expected: Array<Record<string, unknown>>;
  timeoutMs: number;
}

export function compileAssertions(spec: GameSpec): CompiledAssertion[] {
  return spec.verification.map((assertion) => ({
    assertionId: assertion.assertion_id,
    capability: assertion.capability,
    severity: assertion.severity,
    preconditions: assertion.preconditions,
    actions: assertion.actions,
    expected: assertion.expected,
    timeoutMs: assertion.timeout_ms ?? 5000,
  }));
}
