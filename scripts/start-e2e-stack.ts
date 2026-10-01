import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireProductionUnityLicenseDecision } from '@gamerhub/contracts';
import { PostgresDomainRepository } from '@gamerhub/domain';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) =>
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`,
      }),
    );
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  const composeFile = 'infra/compose/dev.yml';
  if (process.argv.includes('--down')) {
    await stopManagedProcesses();
    const result = await run('docker', ['compose', '-f', composeFile, 'down']);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || 'E2E stack teardown failed');
    return;
  }
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'GAMERHUB_API_USER_ID',
    'OBJECT_STORAGE_ENDPOINT',
    'OBJECT_STORAGE_REGION',
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY',
    'OBJECT_STORAGE_SECRET_KEY',
    'ASSET_SCANNER_ENDPOINT',
    'ASSET_DECODER_ENDPOINT',
    'GAMERHUB_E2E_URL',
    'GAMERHUB_API_URL',
    'UNITY_EDITOR_PATH',
    'UNITY_GOLDEN_PROJECT',
    'UNITY_LICENSE_REF',
    'UNITY_LICENSE_DECISION_REF',
    'UNITY_LICENSE_APPROVED_CAPACITY',
    'UNITY_LICENSE_EXPIRES_AT',
    'UNITY_WEB_MODULE_READY',
    'GAMERHUB_WORKSPACE_REPO_PATH',
    'GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE',
    'PLAYTEST_PROBE_ENDPOINT',
    'EVALUATOR_ENDPOINT',
    'PREVIEW_PUBLISHER_ENDPOINT',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0)
    throw new Error(`LICENSED_E2E_CONFIG_REQUIRED: ${missing.join(', ')}`);
  requireProductionUnityLicenseDecision(process.env);
  if (!/^secret:\/\/\S+$/.test(process.env.UNITY_LICENSE_REF ?? ''))
    throw new Error('UNITY_LICENSE_REF_INVALID');
  for (const name of [
    'OBJECT_STORAGE_ENDPOINT',
    'ASSET_SCANNER_ENDPOINT',
    'ASSET_DECODER_ENDPOINT',
    'GAMERHUB_E2E_URL',
    'GAMERHUB_API_URL',
    'PLAYTEST_PROBE_ENDPOINT',
    'EVALUATOR_ENDPOINT',
    'PREVIEW_PUBLISHER_ENDPOINT',
  ]) {
    try {
      const value = new URL(process.env[name] ?? '');
      if (value.protocol !== 'http:' && value.protocol !== 'https:')
        throw new Error('invalid protocol');
    } catch {
      throw new Error(`${name}_INVALID`);
    }
  }
  const editorPath = process.env.UNITY_EDITOR_PATH;
  const goldenProject = process.env.UNITY_GOLDEN_PROJECT;
  if (!editorPath || !goldenProject)
    throw new Error('LICENSED_E2E_CONFIG_REQUIRED');
  if (!existsSync(editorPath)) throw new Error('UNITY_EDITOR_PATH_NOT_FOUND');
  if (
    goldenProject.startsWith('fixture://') ||
    !existsSync(join(goldenProject, 'ProjectSettings', 'ProjectVersion.txt'))
  )
    throw new Error('REAL_UNITY_GOLDEN_PROJECT_REQUIRED');
  if (process.env.UNITY_WEB_MODULE_READY !== '1')
    throw new Error('UNITY_WEB_MODULE_REQUIRED');
  const result = await run('docker', [
    'compose',
    '-f',
    composeFile,
    'up',
    '-d',
    'postgres',
    'redis',
    'object-storage',
    'otel',
  ]);
  if (result.exitCode !== 0)
    throw new Error(result.stderr || 'E2E dependency stack failed to start');
  const health = await run('docker', [
    'compose',
    '-f',
    composeFile,
    'ps',
    '--status',
    'running',
    '--services',
  ]);
  if (health.exitCode !== 0)
    throw new Error(health.stderr || 'E2E dependency health check failed');
  const services = health.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const expected of ['postgres', 'redis', 'object-storage'])
    if (!services.includes(expected))
      throw new Error(`E2E_SERVICE_NOT_RUNNING: ${expected}`);
  const migration = await run(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['db:migrate'],
  );
  if (migration.exitCode !== 0)
    throw new Error(migration.stderr || 'Database migrations failed');
  const identity = process.env.GAMERHUB_API_USER_ID ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(identity))
    throw new Error('GAMERHUB_API_USER_ID_INVALID');
  const repository = PostgresDomainRepository.fromEnvironment();
  try {
    await repository.pool.query(
      `INSERT INTO users (id, email, display_name, status, role)
       VALUES ($1, $2, 'Licensed E2E Creator', 'active', 'creator')
       ON CONFLICT (id) DO NOTHING`,
      [identity, `e2e-${identity}@gamerhub.invalid`],
    );
  } finally {
    await repository.close();
  }
  if (process.env.GAMERHUB_START_SERVICES === '1') await startManagedServices();
  await waitForHttp(`${process.env.GAMERHUB_API_URL}/health`, 'API');
  await waitForHttp(`${process.env.GAMERHUB_E2E_URL}/`, 'Studio/preview');
  console.log(
    JSON.stringify({
      status: 'ready',
      services,
      unity: 'host-licensed',
      api: process.env.GAMERHUB_API_URL,
      previewOrigin: process.env.GAMERHUB_E2E_URL,
      migrations: 'applied',
    }),
  );
}

const managedProcessDirectory = join(process.cwd(), 'artifacts', 'e2e-stack');

function servicePort(name: string, fallback: number): string {
  const value = process.env[name];
  if (!value) return String(fallback);
  const port = new URL(value).port;
  return port || String(fallback);
}

async function startManagedServices(): Promise<void> {
  const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const commonEnv = {
    ...process.env,
    NODE_ENV: 'production',
    GAMERHUB_API_URL: process.env.GAMERHUB_API_URL,
    GAMERHUB_E2E_URL: process.env.GAMERHUB_E2E_URL,
  };
  await startManagedProcess('platform-api', packageManager, ['dev:backend'], {
    ...commonEnv,
    API_PORT: servicePort('GAMERHUB_API_URL', 3001),
  });
  await startManagedProcess(
    'studio-web',
    packageManager,
    ['--filter', '@gamerhub/studio-web', 'dev'],
    {
      ...commonEnv,
      PORT: servicePort('GAMERHUB_E2E_URL', 3000),
    },
  );
}

async function startManagedProcess(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await mkdir(managedProcessDirectory, { recursive: true });
  const logPath = join(managedProcessDirectory, `${name}.log`);
  const pidPath = join(managedProcessDirectory, `${name}.pid`);
  const stdout = openSync(logPath, 'a');
  const stderr = openSync(logPath, 'a');
  try {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdout, stderr],
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
    if (!child.pid) throw new Error(`${name.toUpperCase()}_PID_MISSING`);
    await writeFile(pidPath, String(child.pid), 'utf8');
    child.unref();
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

async function stopManagedProcesses(): Promise<void> {
  if (!existsSync(managedProcessDirectory)) return;
  const files = await readdir(managedProcessDirectory);
  for (const file of files.filter((item) => item.endsWith('.pid'))) {
    const pidPath = join(managedProcessDirectory, file);
    const pid = (await readFile(pidPath, 'utf8')).trim();
    if (/^\d+$/.test(pid)) {
      const result =
        process.platform === 'win32'
          ? await run('taskkill', ['/PID', pid, '/T', '/F'])
          : await run('kill', ['-TERM', `-${pid}`]);
      if (result.exitCode !== 0 && process.platform !== 'win32')
        await run('kill', ['-TERM', pid]);
    }
    await unlink(pidPath).catch(() => undefined);
  }
}

async function waitForHttp(url: string, label: string): Promise<void> {
  let lastError = 'unavailable';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}_HEALTHCHECK_FAILED: ${lastError}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
