import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
if (process.env.GAMERHUB_REAL_FLOW !== '1') {
  console.error(
    'REAL_FLOW_OPT_IN_REQUIRED: set GAMERHUB_REAL_FLOW=1 to run tests against the live stack. These tests create projects, call models, and execute Unity builds.',
  );
  process.exitCode = 1;
} else {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const child = spawn(
    process.execPath,
    [
      cli,
      'test',
      '--config',
      'playwright.flow.config.ts',
      ...process.argv.slice(2).filter((argument) => argument !== '--'),
    ],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    },
  );
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  child.once('error', () => {
    console.error('REAL_FLOW_RUNNER_FAILED');
    process.exitCode = 1;
  });
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.once('SIGINT', () => child.kill('SIGINT'));
}
