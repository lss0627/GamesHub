import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const python = resolve(
  root,
  process.platform === 'win32'
    ? '.venv/Scripts/python.exe'
    : '.venv/bin/python',
);
if (!existsSync(python))
  throw new Error(
    'Create .venv and install apps/platform-fastapi/requirements.txt first',
  );
const child = spawn(
  python,
  process.argv.includes('--test')
    ? ['-m', 'pytest', 'apps/platform-fastapi/tests']
    : ['-m', 'gamerhub_api.serve'],
  {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: resolve(root, 'apps/platform-fastapi'),
      PYTHONUTF8: '1',
    },
  },
);
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
process.once('SIGTERM', () => child.kill('SIGTERM'));
process.once('SIGINT', () => child.kill('SIGINT'));
