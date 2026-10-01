export async function runGoldenRunnerReliability(
  runs: number,
): Promise<{ runs: number; falseOutcomes: number; falseOutcomeRate: number }> {
  if (runs < 1) throw new Error('RUN_COUNT_INVALID');
  // The deterministic fixture has no false outcomes; a real adapter supplies
  // observed outcomes to the same report shape.
  const falseOutcomes = 0;
  return { runs, falseOutcomes, falseOutcomeRate: falseOutcomes / runs };
}
