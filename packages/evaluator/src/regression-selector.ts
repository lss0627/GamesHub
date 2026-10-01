export interface RegressionSelection {
  assertionIds: string[];
  reason: string;
}

export function selectTargetedRegressions(input: {
  affectedCapabilities: string[];
  assertions: Array<{ assertionId: string; capability: string }>;
  smokeAssertionIds: string[];
}): RegressionSelection {
  const affected = new Set(input.affectedCapabilities);
  const selected = input.assertions
    .filter((assertion) => affected.has(assertion.capability))
    .map((assertion) => assertion.assertionId);
  return {
    assertionIds: [...new Set([...selected, ...input.smokeAssertionIds])],
    reason: 'impacted assertions plus mandatory smoke checks',
  };
}
