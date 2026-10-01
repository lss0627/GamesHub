import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const python = resolve(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
function uv(args: string[]) {
  const result = spawnSync('uv', args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error)
    throw new Error(
      '还缺少 Python 安装工具 uv。请先运行 winget install --id astral-sh.uv --exact，再关闭并重新双击启动窗口。',
    );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(python)) uv(['venv', '--python', '3.12', '.venv']);
uv([
  'pip',
  'install',
  '--python',
  python,
  '-r',
  'apps/platform-fastapi/requirements.txt',
]);
