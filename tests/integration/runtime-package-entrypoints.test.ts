import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('loads service entrypoints through native Node package resolution', async () => {
  // Vitest/tsconfig aliases can conceal undeclared pnpm workspace dependencies.
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "await import('./apps/local-dev/src/server.ts'); await import('./apps/local-dev/src/python-agent.ts'); await import('./apps/platform-api/src/server.ts'); await import('./apps/orchestrator-worker/src/worker.ts'); console.log('ENTRYPOINTS_READY');",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        GAMERHUB_START_SERVER: '0',
        GAMERHUB_START_WORKER: '0',
      },
      timeout: 20_000,
      windowsHide: true,
    },
  );
  expect(result.stdout).toContain('ENTRYPOINTS_READY');
}, 30_000);
