import { runUnityGoldenCycle } from '../packages/unity-adapter/src/index';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

function positiveIntegerArgument(name: string, fallback: number): number {
  const flag = `--${name}`;
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  const flagIndex = process.argv.indexOf(flag);
  const raw =
    inline?.slice(flag.length + 1) ??
    (flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`UNITY_${name.toUpperCase().replaceAll('-', '_')}_INVALID`);
  return value;
}

async function main(): Promise<void> {
  const projectPath = process.env.UNITY_GOLDEN_PROJECT;
  const editorPath = process.env.UNITY_EDITOR_PATH;
  if (!projectPath || !editorPath)
    throw new Error(
      'UNITY_GOLDEN_PROJECT and UNITY_EDITOR_PATH are required; fixture execution is test-only',
    );
  const cycles = positiveIntegerArgument('cycles', 1);
  const requiredSuccesses = positiveIntegerArgument(
    'required-successes',
    cycles,
  );
  if (requiredSuccesses > cycles)
    throw new Error('UNITY_REQUIRED_SUCCESSES_EXCEED_CYCLES');
  const result = await runUnityGoldenCycle({
    projectPath,
    editorPath,
    cycles,
    requireFallback: true,
  });
  if (
    result.executionMode !== 'unity' ||
    result.successfulCycles < requiredSuccesses
  )
    throw new Error(
      `Unity golden PoC failed: mode=${result.executionMode} cycles=${result.successfulCycles}/${cycles} required=${requiredSuccesses}`,
    );
  console.log(JSON.stringify({ ...result, cycles, requiredSuccesses }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
