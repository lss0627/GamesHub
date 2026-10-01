import type {
  EngineCapabilities,
  EngineCommand,
  EngineCommandResult,
  EngineExecutionContext,
} from '@gamerhub/engine-adapter';
import { EngineAdapterError } from '@gamerhub/engine-adapter';
import {
  runUnityProcess,
  type UnityProcessResult,
  type UnityProcessRunner,
} from '../batchmode/runner';

export interface UnityCliTransport {
  available(): Promise<boolean>;
  listCommands(): Promise<string[]>;
  execute(command: EngineCommand): Promise<EngineCommandResult>;
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    try {
      const value: unknown = JSON.parse(line.trim());
      if (value && typeof value === 'object' && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      // CLI may print a banner before the structured response.
    }
  }
  return {};
}

function normalizeResult(
  operationId: string,
  processResult: UnityProcessResult,
): EngineCommandResult {
  const output = parseJsonObject(processResult.stdout);
  const failed =
    processResult.exitCode !== 0 ||
    processResult.timedOut ||
    processResult.aborted;
  return {
    operationId,
    status: processResult.aborted
      ? 'cancelled'
      : failed
        ? 'failed'
        : 'succeeded',
    output: {
      ...output,
      stdout: processResult.stdout.slice(-20_000),
      stderr: processResult.stderr.slice(-20_000),
      exitCode: processResult.exitCode,
      transport: 'cli',
    },
    changedFiles: Array.isArray(output.changedFiles)
      ? output.changedFiles.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    warnings: [],
    errors: failed
      ? [
          {
            code: processResult.timedOut
              ? 'ENGINE_TIMEOUT'
              : 'ENGINE_PROCESS_FAILED',
            message: processResult.timedOut
              ? 'Unity CLI exceeded its deadline'
              : 'Unity CLI exited with a failure',
            severity: 'error',
          },
        ]
      : [],
    evidenceRefs: [],
    retryable: Boolean(processResult.timedOut || processResult.aborted),
    ...(typeof output.projectRevision === 'string'
      ? { projectRevision: output.projectRevision }
      : {}),
  };
}

export class ProcessUnityCliTransport implements UnityCliTransport {
  private readonly executable: string;
  private readonly projectPath: string | undefined;
  private readonly processRunner: UnityProcessRunner;
  private readonly timeoutMs: number;

  constructor(
    options: {
      executable?: string;
      projectPath?: string;
      processRunner?: UnityProcessRunner;
      timeoutMs?: number;
    } = {},
  ) {
    this.executable = options.executable ?? 'unity';
    this.projectPath = options.projectPath;
    this.processRunner = options.processRunner ?? runUnityProcess;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async available(): Promise<boolean> {
    const controller = new AbortController();
    const result = await this.processRunner({
      command: this.executable,
      args: ['--version'],
      timeoutMs: this.timeoutMs,
      signal: controller.signal,
    });
    return result.exitCode === 0 && !result.timedOut && !result.aborted;
  }

  async listCommands(): Promise<string[]> {
    const result = await this.run(['command', 'list', '--json']);
    if (result.exitCode !== 0) return [];
    const parsed = parseJsonObject(result.stdout);
    const commands = parsed.commands;
    return Array.isArray(commands)
      ? commands.filter((item): item is string => typeof item === 'string')
      : [];
  }

  async execute(command: EngineCommand): Promise<EngineCommandResult> {
    const result = await this.run([
      'command',
      'execute',
      '--json',
      '--command',
      command.capability,
      ...(this.projectPath ? ['--project-path', this.projectPath] : []),
      '--arguments',
      JSON.stringify(command.arguments),
    ]);
    return normalizeResult(command.commandId, result);
  }

  private run(args: string[]): Promise<UnityProcessResult> {
    return this.processRunner({
      command: this.executable,
      args,
      timeoutMs: this.timeoutMs,
      signal: new AbortController().signal,
    });
  }
}

export class UnityCliClient {
  constructor(private readonly transport: UnityCliTransport) {}

  async health() {
    const available = await this.transport.available();
    return {
      status: available ? ('ready' as const) : ('unavailable' as const),
      version: '0.1.0',
      pipelineVersion: '1.0.0',
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    const healthy = await this.health();
    if (healthy.status !== 'ready')
      throw new EngineAdapterError(
        'ENGINE_UNAVAILABLE',
        'Unity CLI is unavailable',
        true,
      );
    return {
      engineType: 'unity',
      version: healthy.version,
      commands: await this.transport.listCommands(),
      supports: { web_build: true, playmode: true },
    };
  }

  async execute(
    command: EngineCommand,
    _ctx: EngineExecutionContext,
  ): Promise<EngineCommandResult> {
    if (!(await this.transport.available()))
      throw new EngineAdapterError(
        'ENGINE_UNAVAILABLE',
        'Unity CLI is unavailable',
        true,
      );
    return this.transport.execute(command);
  }
}
