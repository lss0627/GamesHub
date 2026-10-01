import type { TestVerification } from './create-game';

/** Only explicit bounded public fields leave adapter diagnostics. */
export function publicTestVerification(
  values: TestVerification[],
): TestVerification[] {
  return values
    .slice(0, 12)
    .filter((value) => /^[A-Za-z_][A-Za-z0-9_.]{0,199}$/.test(value.suite))
    .map((value) => ({
      suite: value.suite,
      mode: ['indexed', 'legacy', 'baseline'].includes(value.mode)
        ? value.mode
        : 'legacy',
      passed: Number.isSafeInteger(value.passed)
        ? Math.max(0, Math.min(2000, value.passed))
        : 0,
      failed: Number.isSafeInteger(value.failed)
        ? Math.max(0, Math.min(2000, value.failed))
        : 0,
      ...(value.reportHash && /^sha256-[a-f0-9]{64}$/.test(value.reportHash)
        ? { reportHash: value.reportHash }
        : {}),
      criteria: value.criteria
        .slice(0, 6)
        .filter((item) => /^[a-z][a-z0-9_]{1,40}\.\d{2}$/.test(item.id))
        .map((item) => ({
          id: item.id,
          description: item.description.slice(0, 300),
          status: ['passed', 'failed', 'missing'].includes(item.status)
            ? item.status
            : 'missing',
          caseCount: Number.isSafeInteger(item.caseCount)
            ? Math.max(0, Math.min(2000, item.caseCount))
            : 0,
        })),
    }));
}
