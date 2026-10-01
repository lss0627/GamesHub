import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inspectUnityComponents } from '../apps/local-dev/src/local-readiness';
import { loadEnvironmentFile } from './dev-env';
import { prepareStudioBuild } from './studio-build-cache';

type Service = 'api' | 'studio';
type Probe = 'offline' | 'ready' | 'blocked' | 'foreign';
export function classifyService(
  kind: Service,
  body: Record<string, unknown>,
): Probe {
  const ours =
    kind === 'studio'
      ? body.service === 'gamerhub-studio'
      : body.service === 'platform-api' &&
        body.framework === 'fastapi' &&
        body.domainTransport === 'stdio';
  return !ours ? 'foreign' : body.status === 'ready' ? 'ready' : 'blocked';
}

export function acquireStartupLock(
  directory: string,
): (() => void) | undefined {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'startup.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(path, 'utf8')).token === token)
            unlinkSync(path);
        } catch {
          /* Already released. */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const lock = JSON.parse(readFileSync(path, 'utf8'));
        if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) return undefined;
        try {
          process.kill(lock.pid, 0);
          return undefined;
        } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== 'ESRCH')
            return undefined;
        }
      } catch {
        if (Date.now() - statSync(path).mtimeMs < 30_000) return undefined;
      }
      unlinkSync(path);
    }
  }
  return undefined;
}

const root = resolve(import.meta.dirname, '..');
const logs = join(root, 'artifacts/dev-tools');
export function retainedStartupPids(
  directory: string,
  ports: number[],
  reused: { backend: boolean; studio: boolean },
): Record<string, number | undefined> {
  const pids: Record<string, number | undefined> = {};
  try {
    const previous = JSON.parse(
      readFileSync(join(directory, 'startup-processes.json'), 'utf8'),
    );
    if (
      !Array.isArray(previous.ports) ||
      previous.ports.length !== ports.length ||
      previous.ports.some(
        (port: unknown, index: number) => port !== ports[index],
      )
    )
      return pids;
    for (const service of ['backend', 'studio'] as const) {
      const pid = previous.pids?.[service];
      if (!reused[service] || !Number.isSafeInteger(pid) || pid < 1) continue;
      try {
        process.kill(pid, 0);
        pids[service] = pid;
      } catch {
        // Old metadata is advisory: unavailable processes are never retained.
      }
    }
  } catch {
    // A first launch or damaged metadata has no previous process to retain.
  }
  return pids;
}
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function listening(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolveResult(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(2000, () => finish(true));
  });
}
async function probe(port: number, kind: Service): Promise<Probe> {
  if (!(await listening(port))) return 'offline';
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/${kind === 'studio' ? 'api/studio-health' : 'health'}`,
      { signal: AbortSignal.timeout(5000) },
    );
    return classifyService(
      kind,
      (await response.json()) as Record<string, unknown>,
    );
  } catch {
    return 'foreign';
  }
}
function stage(message: string) {
  console.log(`\n${message}`);
  writeFileSync(
    join(logs, 'startup-status.json'),
    JSON.stringify({ message, updatedAt: new Date().toISOString() }, null, 2),
  );
}
async function command(
  executable: string,
  args: string[],
  label: string,
  env = process.env,
) {
  await new Promise<void>((done, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env,
    });
    child.once('error', () =>
      reject(new Error(`${label}未能启动，请检查已安装的基础工具。`)),
    );
    child.once('exit', (code) =>
      code === 0
        ? done()
        : reject(new Error(`${label}没有完成，请检查上方提示后重新双击启动。`)),
    );
  });
}
const pnpm = (args: string[], label: string, env = process.env) =>
  process.platform === 'win32'
    ? command(
        'cmd.exe',
        ['/d', '/s', '/c', `pnpm.cmd ${args.join(' ')}`],
        label,
        env,
      )
    : command('pnpm', args, label, env);
function dockerReady() {
  return (
    spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: 5000,
      windowsHide: true,
      stdio: 'ignore',
    }).status === 0
  );
}
function background(
  executable: string,
  args: string[],
  name: string,
  cwd = root,
  env = process.env,
) {
  const out = openSync(join(logs, `${name}.log`), 'a');
  try {
    const child = spawn(executable, args, {
      cwd,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
    const started = trackStartupProcess(child, name);
    child.unref();
    return started;
  } finally {
    closeSync(out);
  }
}
export function trackStartupProcess(child: ChildProcess, name: string) {
  let error: Error | undefined;
  const failure = new Promise<Error>((failed) => {
    const log = `artifacts/dev-tools/${name}.log`;
    const report = (reason: Error) => {
      error ??= reason;
      failed(error);
    };
    child.once('error', () =>
      report(new Error(`${name}未能启动，请查看 ${log} 后重新启动。`)),
    );
    child.once('exit', (code) =>
      report(
        new Error(
          `${name}提前退出${code === null ? '' : `（退出码 ${code}）`}，请查看 ${log} 后重新启动。`,
        ),
      ),
    );
  });
  return {
    pid: child.pid,
    failure,
    get error() {
      return error;
    },
  };
}
export async function waitService(
  port: number,
  kind: Service,
  started?: ReturnType<typeof trackStartupProcess>,
  options: {
    probe?: typeof probe;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
) {
  const controller = new AbortController();
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const race = <T>(pending: Promise<T>) =>
    started
      ? Promise.race([
          pending,
          started.failure.then((error) => {
            throw error;
          }),
        ])
      : pending;
  try {
    while (Date.now() < deadline) {
      if (started?.error) throw started.error;
      const result = await race((options.probe ?? probe)(port, kind));
      if (started?.error) throw started.error;
      if (result === 'ready' || result === 'blocked') return result;
      await race(
        delay(options.pollIntervalMs ?? 1500, undefined, {
          signal: controller.signal,
        }),
      );
    }
    throw new Error(
      `${kind === 'api' ? '创作服务' : '创作页面'}启动超时。请查看 artifacts/dev-tools 中的日志，再重新启动。`,
    );
  } finally {
    controller.abort();
  }
}
function openStudio(port: number) {
  if (process.argv.includes('--no-open')) return;
  if (process.platform === 'win32')
    spawn(
      'cmd.exe',
      ['/d', '/s', '/c', `start "" "http://127.0.0.1:${port}"`],
      { windowsHide: true, stdio: 'ignore' },
    ).unref();
}
export async function startGamerHub() {
  process.chdir(root);
  const release = acquireStartupLock(logs);
  if (!release) {
    console.log('正在启动中，请等待已有启动窗口完成。');
    return;
  }
  try {
    loadEnvironmentFile();
    const ports = [
      Number(process.env.STUDIO_PORT ?? 3000),
      Number(process.env.API_PORT ?? 3001),
      Number(process.env.LOCAL_SUPPORT_PORT ?? 3010),
    ];
    if (
      ports.some(
        (port) => !Number.isSafeInteger(port) || port < 1024 || port > 65535,
      ) ||
      new Set(ports).size !== 3
    )
      throw new Error('启动端口配置无效，请检查项目配置。');
    const [studioPort, apiPort, supportPort] = ports as [
      number,
      number,
      number,
    ];
    stage('1/6 检查是否已经启动…');
    const [studio, api, support] = await Promise.all([
      probe(studioPort, 'studio'),
      probe(apiPort, 'api'),
      probe(supportPort, 'api'),
    ]);
    if ([studio, api, support].includes('foreign'))
      throw new Error(
        '项目端口被其他程序占用或服务没有正确响应。请关闭冲突的程序后再试；启动器不会结束未知进程。',
      );
    if ([studio, api, support].every((value) => value === 'ready')) {
      stage('项目已经运行，直接打开即可。');
      openStudio(studioPort);
      return;
    }
    if ((api === 'offline') !== (support === 'offline'))
      throw new Error('创作服务仅启动了一部分，请检查已有后台服务日志后重试。');
    stage('2/6 检查本地存储服务…');
    if (!dockerReady()) {
      const desktop = join(
        process.env.ProgramFiles ?? 'C:/Program Files',
        'Docker/Docker/Docker Desktop.exe',
      );
      if (!existsSync(desktop))
        throw new Error(
          '请先安装并打开 Docker Desktop：https://www.docker.com/products/docker-desktop/，然后重新双击启动。',
        );
      background(desktop, [], 'docker-start');
      const deadline = Date.now() + 120_000;
      while (!dockerReady()) {
        if (Date.now() > deadline)
          throw new Error(
            'Docker Desktop尚未启动成功。请查看它的提示并完成首次设置，然后重试；不要重置或删除项目数据。',
          );
        await pause(2000);
      }
    }
    await pnpm(['dev:bootstrap'], '配置检测');
    loadEnvironmentFile('.env.local', process.env, { override: true });
    const python = join(
      root,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    const requirements = createHash('sha256')
      .update(
        readFileSync(join(root, 'apps/platform-fastapi/requirements.txt')),
      )
      .digest('hex');
    const stamp = join(logs, 'python-requirements.sha256');
    if (
      !existsSync(python) ||
      !existsSync(stamp) ||
      readFileSync(stamp, 'utf8') !== requirements
    ) {
      stage('正在准备Python创作服务（首次需要一些时间）…');
      await pnpm(['setup:python'], 'Python依赖安装');
      writeFileSync(stamp, requirements);
    }
    stage('3/6 检查Unity与网页导出组件…');
    let components = inspectUnityComponents(process.env);
    if (!components.editorFound || !components.webModuleFound) {
      if (process.platform !== 'win32')
        throw new Error('请通过Unity Hub安装固定版本编辑器和WebGL组件。');
      stage(
        '正在自动安装Unity组件；首次下载约5GB。如系统要求授权，请完成系统提示。',
      );
      const args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(root, 'scripts/complete-unity-install.ps1'),
        '-SkipBootstrap',
      ];
      if (components.editorFound && process.env.UNITY_EDITOR_PATH)
        args.push(
          '-InstallRoot',
          dirname(dirname(process.env.UNITY_EDITOR_PATH)),
        );
      await command('powershell.exe', args, 'Unity组件安装');
      await pnpm(['dev:bootstrap'], 'Unity路径配置');
      loadEnvironmentFile('.env.local', process.env, { override: true });
      components = inspectUnityComponents(process.env);
    }
    if (!components.ready)
      throw new Error('Unity模板或组件不完整，请检查项目文件后重新启动。');
    const { chromium } = await import('@playwright/test');
    if (!existsSync(chromium.executablePath()))
      await pnpm(
        ['exec', 'playwright', 'install', 'chromium'],
        '试玩浏览器安装',
      );
    stage('4/6 准备项目存储与数据库…');
    await pnpm(['dev:infra'], '本地存储启动');
    await pnpm(['db:migrate'], '数据库准备');
    stage('5/6 启动创作服务…');
    const pids = retainedStartupPids(logs, ports, {
      backend: api !== 'offline',
      studio: studio !== 'offline',
    });
    let backendProcess: ReturnType<typeof background> | undefined;
    let studioProcess: ReturnType<typeof background> | undefined;
    if (api === 'offline')
      backendProcess = background(
        python,
        ['-m', 'gamerhub_api.serve'],
        'gamerhub-backend',
        root,
        {
          ...process.env,
          PYTHONPATH: join(root, 'apps/platform-fastapi'),
          PYTHONUTF8: '1',
        },
      );
    if (backendProcess) pids.backend = backendProcess.pid;
    await waitService(apiPort, 'api', backendProcess);
    await waitService(supportPort, 'api', backendProcess);
    if (studio === 'offline') {
      stage('6/6 准备创作页面…');
      const build = await prepareStudioBuild(root, process.env, () =>
        pnpm(['--filter', '@gamerhub/studio-web', 'build'], '创作页面构建', {
          ...process.env,
          NODE_ENV: 'production',
        }),
      );
      if (build === 'reused') stage('6/6 页面文件没有变化，复用已完成的构建…');
      studioProcess = background(
        process.execPath,
        [
          join(root, 'apps/studio-web/node_modules/next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(studioPort),
        ],
        'gamerhub-studio',
        join(root, 'apps/studio-web'),
        { ...process.env, NODE_ENV: 'production' },
      );
    }
    if (studioProcess) pids.studio = studioProcess.pid;
    await waitService(studioPort, 'studio', studioProcess);
    const backendState = await waitService(apiPort, 'api', backendProcess);
    await waitService(supportPort, 'api', backendProcess);
    writeFileSync(
      join(logs, 'startup-processes.json'),
      JSON.stringify(
        { pids, ports, startedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    stage(
      backendState === 'ready'
        ? '启动完成。Unity工程、素材导入和网页构建会在确认方案后自动完成；许可将在实际制作时检查。'
        : '页面已启动。还有环境项目需要处理，请按页面提示完成后再制作。',
    );
    console.log(`打开 http://127.0.0.1:${studioPort}，从一句游戏想法开始。`);
    openStudio(studioPort);
  } finally {
    release();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void startGamerHub().catch((error) => {
    stage(error instanceof Error ? error.message : '启动没有完成，请重试。');
    process.exitCode = 1;
  });
}
