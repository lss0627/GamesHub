import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { SandboxPolicy } from './workspace-provider';

export interface ContainerCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type ContainerCommandRunner = (
  args: string[],
) => Promise<ContainerCommandResult>;

export interface ContainerHandle {
  runId: string;
  containerId: string;
  image: string;
  projectPath: string;
  assetsPath: string;
  buildPath: string;
  startedAt: string;
  status: 'running' | 'cancelled' | 'quarantined';
  maximumDurationSeconds: number;
}

export interface ContainerStartInput {
  runId: string;
  image: string;
  projectPath: string;
  assetsPath: string;
  buildPath: string;
  workspacePath?: string;
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  maximumDurationSeconds?: number;
}

export interface ContainerRunnerOptions {
  dockerPath?: string;
  commandRunner?: ContainerCommandRunner;
  policy?: SandboxPolicy;
  network?: 'none';
}

function runDockerProcess(dockerPath: string): ContainerCommandRunner {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(dockerPath, args, {
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

function assertToken(value: string, code: string): void {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  )
    throw new Error(code);
}

function assertMountPath(value: string): void {
  assertToken(value, 'CONTAINER_PATH_INVALID');
  if (!isAbsolute(value)) throw new Error('CONTAINER_PATH_INVALID');
}

function safeRunId(runId: string): string {
  assertToken(runId, 'RUN_ID_INVALID');
  const value = runId.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
  if (!value) throw new Error('RUN_ID_INVALID');
  return value.slice(0, 48);
}

function commandError(result: ContainerCommandResult, fallback: string): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || fallback;
  return new Error(`${fallback}: ${detail.slice(-1000)}`);
}

export class ContainerRunner {
  private readonly dockerPath: string;
  private readonly commandRunner: ContainerCommandRunner;
  private readonly policy: SandboxPolicy;
  private readonly handles = new Map<string, ContainerHandle>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(options: ContainerRunnerOptions = {}) {
    this.dockerPath = options.dockerPath ?? 'docker';
    this.commandRunner =
      options.commandRunner ?? runDockerProcess(this.dockerPath);
    this.policy = options.policy ?? new SandboxPolicy();
    if (options.network && options.network !== 'none')
      throw new Error('SANDBOX_NETWORK_POLICY_INVALID');
  }

  async start(input: ContainerStartInput): Promise<ContainerHandle> {
    const normalizedRunId = safeRunId(input.runId);
    assertToken(input.image, 'CONTAINER_IMAGE_INVALID');
    assertMountPath(input.projectPath);
    assertMountPath(input.assetsPath);
    assertMountPath(input.buildPath);
    if (input.workspacePath) assertMountPath(input.workspacePath);
    const maximumDurationSeconds =
      input.maximumDurationSeconds ?? this.policy.maxWallClockSeconds;
    if (
      !Number.isInteger(maximumDurationSeconds) ||
      maximumDurationSeconds < 1 ||
      maximumDurationSeconds > this.policy.maxWallClockSeconds
    )
      throw new Error('SANDBOX_RESOURCE_LIMIT');
    const existing = this.handles.get(input.runId);
    if (existing) return structuredClone(existing);

    const args = [
      'run',
      '--detach',
      '--rm',
      '--name',
      `gamerhub-${normalizedRunId}`,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--cpus',
      String(this.policy.maxCpu),
      '--memory',
      `${this.policy.maxMemoryMb / 1024}g`,
      '--pids-limit',
      String(this.policy.maxPids),
      '--storage-opt',
      `size=${this.policy.maxDiskGb}G`,
      '--user',
      '1000:1000',
      '--security-opt',
      'seccomp=default',
      '--ulimit',
      'nofile=4096:4096',
      '--ulimit',
      'core=0',
      '--mount',
      `type=bind,source=${input.projectPath},target=/workspace/project`,
      '--mount',
      `type=bind,source=${input.assetsPath},target=/workspace/assets,readonly`,
      '--mount',
      `type=bind,source=${input.buildPath},target=/workspace/build`,
      '--label',
      'com.gamerhub.managed=true',
      '--label',
      `com.gamerhub.run-id=${normalizedRunId}`,
    ];
    if (input.workspacePath)
      args.push(
        '--mount',
        `type=bind,source=${input.workspacePath},target=/workspace/shared`,
      );
    for (const [key, value] of Object.entries(input.environment ?? {})) {
      assertToken(key, 'CONTAINER_ENV_INVALID');
      assertToken(value, 'CONTAINER_ENV_INVALID');
      args.push('--env', `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(input.labels ?? {})) {
      assertToken(key, 'CONTAINER_LABEL_INVALID');
      assertToken(value, 'CONTAINER_LABEL_INVALID');
      args.push('--label', `${key}=${value}`);
    }
    args.push(input.image);

    const result = await this.commandRunner(args);
    if (result.exitCode !== 0)
      throw commandError(result, 'CONTAINER_START_FAILED');
    const containerId = result.stdout.trim().split(/\s+/)[0];
    if (!containerId) throw new Error('CONTAINER_ID_MISSING');
    assertToken(containerId, 'CONTAINER_ID_INVALID');
    const handle: ContainerHandle = {
      runId: input.runId,
      containerId,
      image: input.image,
      projectPath: input.projectPath,
      assetsPath: input.assetsPath,
      buildPath: input.buildPath,
      startedAt: new Date().toISOString(),
      status: 'running',
      maximumDurationSeconds,
    };
    this.handles.set(input.runId, handle);
    this.timers.set(
      input.runId,
      setTimeout(() => {
        void this.cancel(input.runId, 'wall_clock_limit').catch(() => {
          void this.quarantine(input.runId, 'wall_clock_cleanup_failed');
        });
      }, maximumDurationSeconds * 1000),
    );
    return structuredClone(handle);
  }

  get(runId: string): ContainerHandle | undefined {
    const handle = this.handles.get(runId);
    return handle ? structuredClone(handle) : undefined;
  }

  async cancel(runId: string, reason = 'cancelled'): Promise<void> {
    const handle = this.handles.get(runId);
    if (!handle) return;
    assertToken(reason, 'CANCEL_REASON_INVALID');
    const result = await this.commandRunner([
      'rm',
      '--force',
      handle.containerId,
    ]);
    if (result.exitCode !== 0)
      throw commandError(result, 'CONTAINER_CANCEL_FAILED');
    handle.status = 'cancelled';
    this.handles.delete(runId);
    const timer = this.timers.get(runId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runId);
  }

  async quarantine(
    runId: string,
    reason = 'cleanup_failed',
  ): Promise<ContainerHandle> {
    const handle = this.handles.get(runId);
    if (!handle) throw new Error('CONTAINER_NOT_FOUND');
    assertToken(reason, 'QUARANTINE_REASON_INVALID');
    handle.status = 'quarantined';
    return structuredClone(handle);
  }

  async cleanup(): Promise<{ cleaned: number; quarantined: number }> {
    let cleaned = 0;
    let quarantined = 0;
    for (const [runId, handle] of [...this.handles]) {
      try {
        await this.cancel(runId, 'cleanup');
        cleaned += 1;
      } catch {
        handle.status = 'quarantined';
        quarantined += 1;
      }
    }
    return { cleaned, quarantined };
  }
}
