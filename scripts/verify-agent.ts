import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Keep verification independent of live stack credentials and opt-in flags.
// This script deliberately does not load .env.local.
const env = { ...process.env };
for (const name of [
  'GAMERHUB_REQUIRE_E2E',
  'GAMERHUB_REAL_FLOW',
  'GAMERHUB_AGENT_PG_TEST',
  'GAMERHUB_ART_PG_TEST',
  'GAMERHUB_ACCEPTANCE_URL',
  'GAMERHUB_ACCEPTANCE_EVIDENCE_FILE',
  'GAMERHUB_RELEASE_PREVIEW_EVIDENCE',
  'UNITY_EDITOR_PATH',
  'UNITY_GOLDEN_PROJECT',
])
  env[name] = '';

async function main(): Promise<void> {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('VERIFY_RUN_WITH_PNPM');
  for (const task of ['lint', 'typecheck', 'test:fastapi', 'test', 'build']) {
    console.log(`\n[verify:agent] ${task}`);
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [pnpm, 'run', task], {
        cwd: resolveRoot,
        env,
        windowsHide: true,
        stdio: 'inherit',
        shell: false,
      });
      const stop = () => child.kill('SIGTERM');
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      child.once('error', reject);
      child.once('exit', (code) => {
        process.removeListener('SIGTERM', stop);
        process.removeListener('SIGINT', stop);
        resolve(code ?? 1);
      });
    });
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
  }
  console.log(
    '[verify:agent] Offline checks passed; live creation flow requires pnpm test:flow.',
  );
}

const resolveRoot = resolve(import.meta.dirname, '..');
void main().catch(() => {
  console.error(
    'AGENT_VERIFICATION_FAILED: run pnpm verify:agent from the installed workspace.',
  );
  process.exitCode = 1;
});
