import { probeAgentRuntime } from './agent-doctor-lib';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  if (args.some((argument) => argument !== '--require-image')) {
    console.error(
      JSON.stringify({
        status: 'blocked',
        reason: 'USAGE: pnpm agent:doctor [--require-image]',
      }),
    );
    process.exitCode = 1;
    return;
  }
  const result = await probeAgentRuntime({
    endpoint: process.env.GAMERHUB_API_URL ?? 'http://127.0.0.1:3001',
    bearerToken: process.env.GAMERHUB_API_BEARER_TOKEN,
    requireImage: args.includes('--require-image'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ready') process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    JSON.stringify({ status: 'blocked', reason: 'AGENT_DOCTOR_FAILED' }),
  );
  process.exitCode = 1;
});
