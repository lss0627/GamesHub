import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  BuildArtifact,
  CompileResult,
  EngineAdapter,
  EngineCapabilities,
  EngineCommand,
  EngineCommandResult,
  EngineExecutionContext,
  EngineTestRequest,
  EngineTestResult,
  PlayModeRequest,
  PlaySession,
  ProjectRef,
  WebBuildRequest,
} from '@gamerhub/engine-adapter';
import {
  EngineAdapterError,
  InMemoryEngineAdapter,
  validateEngineCommand,
} from '@gamerhub/engine-adapter';
import { UnityBatchmodeRunner } from './batchmode/runner';
import { ProcessUnityCliTransport, UnityCliClient } from './cli/client';

export * from '@gamerhub/engine-adapter';
export * from './batchmode/runner';
export * from './cli/client';
export * from './commands/build-web';
export * from './commands/test';
export * from './performance';

export interface GoldenCycleResult {
  successfulCycles: number;
  operations: string[];
  fallbackVerified: boolean;
  executionMode: 'unity' | 'fixture';
  cycleEvidence?: Array<{ cycle: number; contentHash: string }>;
}

function assertProjectPath(projectPath: string): void {
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory())
    throw new EngineAdapterError(
      'UNITY_GOLDEN_PROJECT_NOT_FOUND',
      'The configured Unity golden project does not exist',
    );
}

function buildDirectoryHash(path: string): string {
  const hash = createHash('sha256');
  if (existsSync(path) && statSync(path).isFile()) {
    hash.update(path);
    hash.update(readFileSync(path));
    return `sha256-${hash.digest('hex')}`;
  }
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === 'Library' || entry.name === 'Temp') continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else {
        hash.update(relative(path, child).replaceAll('\\', '/'));
        hash.update(readFileSync(child));
      }
    }
  };
  visit(path);
  return `sha256-${hash.digest('hex')}`;
}

function outputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function runUnityGoldenCycle(options: {
  projectPath: string;
  cycles: number;
  requireFallback: boolean;
  editorPath?: string;
  cliPath?: string;
  allowFixture?: boolean;
}): Promise<GoldenCycleResult> {
  if (options.cycles < 1) throw new Error('UNITY_GOLDEN_CYCLES_INVALID');
  const operations = [
    'scene.edit',
    'compile',
    'play',
    'state.read',
    'test',
    'web.build',
  ];
  if (options.projectPath.startsWith('fixture://')) {
    if (!options.allowFixture)
      throw new EngineAdapterError(
        'UNITY_REAL_EXECUTION_REQUIRED',
        'The golden PoC requires a licensed Unity execution mode',
      );
    return {
      successfulCycles: options.cycles,
      operations,
      fallbackVerified: options.requireFallback,
      executionMode: 'fixture',
    };
  }
  assertProjectPath(options.projectPath);
  const editorPath = options.editorPath ?? process.env.UNITY_EDITOR_PATH;
  if (!editorPath)
    throw new EngineAdapterError(
      'UNITY_EDITOR_PATH_REQUIRED',
      'UNITY_EDITOR_PATH is required for the real golden PoC',
      true,
    );
  const cliPath = options.cliPath ?? process.env.UNITY_CLI_PATH;
  const adapter = new UnityEngineAdapter({
    editorPath,
    projectPath: options.projectPath,
    ...(cliPath ? { cliPath } : {}),
  });
  const context: EngineExecutionContext = {
    runId: `golden-${Date.now()}`,
    taskId: 'golden-cycle',
    workspaceRoot: options.projectPath,
    capabilities: [
      'scene.edit',
      'compile',
      'play',
      'state.read',
      'test',
      'build.web',
    ],
  };
  const evidence: Array<{ cycle: number; contentHash: string }> = [];
  let successfulCycles = 0;
  for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
    await adapter.execute(
      {
        commandId: `golden-scene-${cycle}`,
        capability: 'scene.edit',
        safetyClass: 'project_write',
        projectRef: options.projectPath,
        arguments: { path: 'Assets/Game/Scenes/Runner.unity' },
        timeoutMs: 30_000,
      },
      context,
    );
    const compile = await adapter.compile(
      { projectRef: options.projectPath, path: options.projectPath },
      context,
    );
    if (compile.status !== 'succeeded') break;
    const play = await adapter.startPlayMode(
      { projectRef: options.projectPath, seed: 42, fixedDeltaTimeMs: 20 },
      context,
    );
    if (play.status !== 'started') break;
    await adapter.execute(
      {
        commandId: `golden-state-${cycle}`,
        capability: 'state.read',
        safetyClass: 'read_only',
        projectRef: options.projectPath,
        arguments: {},
        timeoutMs: 30_000,
      },
      context,
    );
    await adapter.stopPlayMode(play.sessionId, context);
    const tests = await adapter.runTests(
      {
        projectRef: options.projectPath,
        mode: 'playmode',
        testFilter: 'Runner',
      },
      context,
    );
    if (tests.status !== 'succeeded' || tests.failed > 0) break;
    const build = await adapter.buildWeb(
      {
        projectRef: options.projectPath,
        outputPath: `Builds/Web/GamerHubGolden-${cycle}`,
      },
      context,
    );
    if (build.status !== 'succeeded') break;
    successfulCycles += 1;
    evidence.push({ cycle, contentHash: build.contentHash });
  }
  let fallbackVerified = false;
  if (options.requireFallback) {
    const fallback = new UnityEngineAdapter({
      editorPath,
      projectPath: options.projectPath,
      requireBatchmode: true,
    });
    const compile = await fallback.compile(
      { projectRef: options.projectPath, path: options.projectPath },
      context,
    );
    fallbackVerified = compile.provenance.transport === 'batchmode';
  }
  return {
    successfulCycles,
    operations,
    fallbackVerified,
    executionMode: 'unity',
    cycleEvidence: evidence,
  };
}

export interface UnityEngineAdapterOptions {
  editorPath?: string;
  projectPath?: string;
  cliPath?: string;
  cliClient?: UnityCliClient;
  batchmodeRunner?: UnityBatchmodeRunner;
  requireBatchmode?: boolean;
}

export class UnityEngineAdapter implements EngineAdapter {
  readonly engineType = 'unity';
  readonly adapterVersion = '1.0.0';
  readonly executionMode = 'unity' as const;
  private readonly projectPath: string | undefined;
  private readonly cli: UnityCliClient | undefined;
  private readonly batchmode: UnityBatchmodeRunner;
  private readonly requireBatchmode: boolean;
  private readonly operations = new Map<string, 'cli' | 'batchmode'>();

  constructor(options: UnityEngineAdapterOptions = {}) {
    this.projectPath = options.projectPath;
    this.cli =
      options.cliClient ??
      (options.cliPath
        ? new UnityCliClient(
            new ProcessUnityCliTransport({
              executable: options.cliPath,
              ...(options.projectPath
                ? { projectPath: options.projectPath }
                : {}),
            }),
          )
        : undefined);
    this.batchmode =
      options.batchmodeRunner ??
      new UnityBatchmodeRunner({
        ...(options.editorPath ? { editorPath: options.editorPath } : {}),
        ...(options.projectPath ? { projectPath: options.projectPath } : {}),
      });
    this.requireBatchmode = options.requireBatchmode ?? false;
  }

  async discoverCapabilities(): Promise<EngineCapabilities> {
    if (!this.requireBatchmode && this.cli) {
      try {
        return await this.cli.capabilities();
      } catch (error) {
        if (!(error instanceof EngineAdapterError) || !error.retryable)
          throw error;
      }
    }
    return {
      version: '6000.0.80f1',
      engineType: this.engineType,
      commands: [
        'scene.create',
        'asset.import',
        'component.set_property',
        'compile',
        'test',
        'build.web',
      ],
      supports: { web_build: true, playmode: false, batchmode_fallback: true },
    };
  }

  async inspectProject(project: ProjectRef): Promise<Record<string, unknown>> {
    const projectPath = project.path ?? this.projectPath;
    if (!projectPath)
      throw new EngineAdapterError(
        'ENGINE_UNAVAILABLE',
        'Unity project path is required',
        true,
      );
    assertProjectPath(projectPath);
    const versionFile = join(
      projectPath,
      'ProjectSettings',
      'ProjectVersion.txt',
    );
    if (!existsSync(versionFile))
      throw new EngineAdapterError(
        'ENGINE_VERSION_MISMATCH',
        'Unity ProjectVersion.txt is missing',
      );
    const versionText = readFileSync(versionFile, 'utf8');
    const versionMatch = versionText.match(/m_EditorVersion:\s*(\S+)/);
    const engineVersion = versionMatch?.[1];
    if (engineVersion !== '6000.0.80f1')
      throw new EngineAdapterError(
        'ENGINE_VERSION_MISMATCH',
        `Expected Unity 6000.0.80f1, got ${engineVersion ?? 'unknown'}`,
      );
    return {
      projectRef: project.projectRef,
      path: projectPath,
      engineVersion,
      revision: `sha256-${createHash('sha256').update(versionText).digest('hex')}`,
      transport: this.requireBatchmode
        ? 'batchmode'
        : this.cli
          ? 'cli'
          : 'batchmode',
    };
  }

  async execute(
    command: EngineCommand,
    ctx: EngineExecutionContext,
  ): Promise<EngineCommandResult> {
    validateEngineCommand(command);
    if (!ctx.capabilities.includes(command.capability))
      throw new EngineAdapterError(
        'COMMAND_NOT_ALLOWED',
        `Capability ${command.capability} is not authorized`,
      );
    if (command.safetyClass === 'destructive' && !ctx.checkpointRef)
      throw new EngineAdapterError(
        'CHECKPOINT_REQUIRED',
        'Destructive commands require a checkpoint',
      );
    if (!this.requireBatchmode && this.cli) {
      try {
        const result = await this.cli.execute(command, ctx);
        this.operations.set(result.operationId, 'cli');
        return result;
      } catch (error) {
        if (!(error instanceof EngineAdapterError) || !error.retryable)
          throw error;
      }
    }
    if (
      ['test', 'test.editmode', 'test.playmode'].includes(command.capability)
    ) {
      const mode =
        command.capability === 'test.editmode'
          ? 'editmode'
          : command.capability === 'test.playmode'
            ? 'playmode'
            : command.arguments.mode;
      if (mode !== 'editmode' && mode !== 'playmode')
        throw new EngineAdapterError(
          'COMMAND_ARGUMENT_INVALID',
          'Test mode must be editmode or playmode',
        );
      const result = await this.batchmode.runTests(
        mode,
        typeof command.arguments.filter === 'string'
          ? command.arguments.filter
          : '',
        {
          timeoutMs: command.timeoutMs,
          ...(ctx.traceId && ctx.spanId
            ? { traceContext: { traceId: ctx.traceId, spanId: ctx.spanId } }
            : {}),
        },
      );
      this.operations.set(result.operationId, 'batchmode');
      return result;
    }
    const method = this.batchmodeMethod(command.capability);
    if (!method)
      throw new EngineAdapterError(
        'COMMAND_NOT_ALLOWED',
        `No real Unity transport supports ${command.capability}`,
      );
    const result = await this.batchmode.run(
      method,
      this.stringArguments(command.arguments),
      {
        timeoutMs: command.timeoutMs,
        ...(ctx.traceId && ctx.spanId
          ? { traceContext: { traceId: ctx.traceId, spanId: ctx.spanId } }
          : {}),
      },
    );
    this.operations.set(result.operationId, 'batchmode');
    return result;
  }

  async compile(
    project: ProjectRef,
    ctx: EngineExecutionContext,
  ): Promise<CompileResult> {
    const result = await this.dispatchLifecycle('compile', project, ctx, {
      method: 'GamerHub.AgentBridge.Editor.BatchmodeMethods.Compile',
    });
    const output = outputRecord(result.output);
    return {
      ...result,
      diagnostics: Array.isArray(output.diagnostics)
        ? (output.diagnostics as CompileResult['diagnostics'])
        : result.errors,
      provenance: { transport: this.transportFor(result.operationId) },
    };
  }

  async runTests(
    request: EngineTestRequest,
    ctx: EngineExecutionContext,
  ): Promise<EngineTestResult> {
    let result: EngineCommandResult;
    if (!this.requireBatchmode && this.cli) {
      try {
        result = await this.cli.execute(
          {
            commandId: `test-${Date.now()}`,
            capability: 'test',
            safetyClass: 'runtime',
            projectRef: request.projectRef,
            arguments: { mode: request.mode, filter: request.testFilter ?? '' },
            timeoutMs: 20 * 60 * 1000,
          },
          ctx,
        );
        this.operations.set(result.operationId, 'cli');
      } catch (error) {
        if (!(error instanceof EngineAdapterError) || !error.retryable)
          throw error;
        result = await this.batchmode.runTests(
          request.mode,
          request.testFilter ?? '',
          ctx.traceId && ctx.spanId
            ? { traceContext: { traceId: ctx.traceId, spanId: ctx.spanId } }
            : {},
        );
        this.operations.set(result.operationId, 'batchmode');
      }
    } else {
      result = await this.batchmode.runTests(
        request.mode,
        request.testFilter ?? '',
        ctx.traceId && ctx.spanId
          ? { traceContext: { traceId: ctx.traceId, spanId: ctx.spanId } }
          : {},
      );
      this.operations.set(result.operationId, 'batchmode');
    }
    const output = outputRecord(result.output);
    return {
      ...result,
      passed:
        typeof output.passed === 'number'
          ? output.passed
          : result.status === 'succeeded'
            ? 1
            : 0,
      failed:
        typeof output.failed === 'number'
          ? output.failed
          : result.status === 'succeeded'
            ? 0
            : 1,
    };
  }

  async startPlayMode(
    request: PlayModeRequest,
    ctx: EngineExecutionContext,
  ): Promise<PlaySession> {
    const result = await this.dispatchLifecycle(
      'play',
      { projectRef: request.projectRef, path: request.projectRef },
      ctx,
      {
        method: 'GamerHub.AgentBridge.Editor.BatchmodeMethods.StartPlayMode',
        args: {
          seed: String(request.seed),
          fixedDeltaTimeMs: String(request.fixedDeltaTimeMs),
        },
      },
    );
    const output = outputRecord(result.output);
    return {
      sessionId:
        typeof output.sessionId === 'string'
          ? output.sessionId
          : result.operationId,
      status: result.status === 'succeeded' ? 'started' : 'failed',
      transport: this.transportFor(result.operationId),
    };
  }

  async stopPlayMode(
    sessionId: string,
    ctx: EngineExecutionContext,
  ): Promise<void> {
    await this.dispatchLifecycle(
      'play.stop',
      {
        projectRef: sessionId,
        ...(this.projectPath ? { path: this.projectPath } : {}),
      },
      ctx,
      {
        method: 'GamerHub.AgentBridge.Editor.BatchmodeMethods.StopPlayMode',
        args: { sessionId },
      },
    );
  }

  async buildWeb(
    request: WebBuildRequest,
    ctx: EngineExecutionContext,
  ): Promise<BuildArtifact> {
    const result = await this.dispatchLifecycle(
      'build.web',
      { projectRef: request.projectRef, path: request.projectRef },
      ctx,
      {
        method: 'GamerHub.AgentBridge.Editor.BatchmodeMethods.BuildWeb',
        args: { outputPath: request.outputPath },
      },
    );
    const output = outputRecord(result.output);
    const projectPath = this.projectPath ?? request.projectRef;
    const artifactPathValue =
      typeof output.artifactPath === 'string'
        ? output.artifactPath
        : request.outputPath;
    const artifactPath = isAbsolute(artifactPathValue)
      ? artifactPathValue
      : resolve(projectPath, artifactPathValue);
    const contentHash =
      typeof output.contentHash === 'string'
        ? output.contentHash
        : existsSync(artifactPath)
          ? buildDirectoryHash(artifactPath)
          : `sha256-${createHash('sha256').update(JSON.stringify(output)).digest('hex')}`;
    return {
      ...result,
      contentHash,
      artifactPath,
      provenance: {
        engineVersion: '6000.0.80f1',
        adapterVersion: this.adapterVersion,
        transport: this.transportFor(result.operationId),
      },
    };
  }

  async cancel(operationId: string): Promise<void> {
    const transport = this.operations.get(operationId);
    if (transport === 'batchmode') await this.batchmode.cancel(operationId);
    this.operations.delete(operationId);
  }

  private async dispatchLifecycle(
    capability: string,
    project: ProjectRef,
    ctx: EngineExecutionContext,
    fallback: { method: string; args?: Record<string, string> },
  ): Promise<EngineCommandResult> {
    const command: EngineCommand = {
      commandId: `${capability}-${Date.now()}`,
      capability,
      safetyClass: capability === 'build.web' ? 'build' : 'runtime',
      projectRef: project.projectRef,
      arguments: fallback.args ?? {},
      timeoutMs: 20 * 60 * 1000,
    };
    if (!this.requireBatchmode && this.cli) {
      try {
        const result = await this.cli.execute(command, ctx);
        this.operations.set(result.operationId, 'cli');
        return result;
      } catch (error) {
        if (!(error instanceof EngineAdapterError) || !error.retryable)
          throw error;
      }
    }
    const result = await this.batchmode.run(
      fallback.method,
      fallback.args ?? {},
      ctx.traceId && ctx.spanId
        ? { traceContext: { traceId: ctx.traceId, spanId: ctx.spanId } }
        : {},
    );
    this.operations.set(result.operationId, 'batchmode');
    return result;
  }

  private batchmodeMethod(capability: string): string | undefined {
    return {
      compile: 'GamerHub.AgentBridge.Editor.BatchmodeMethods.Compile',
      'build.web': 'GamerHub.AgentBridge.Editor.BatchmodeMethods.BuildWeb',
      'component.set_property':
        'GamerHub.AgentBridge.Editor.BatchmodeMethods.ApplyParameter',
      'scene.create':
        'GamerHub.AgentBridge.Editor.BatchmodeMethods.CreateScene',
      'asset.import':
        'GamerHub.AgentBridge.Editor.BatchmodeMethods.ImportAsset',
    }[capability];
  }

  private stringArguments(
    arguments_: Record<string, unknown>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(arguments_).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]),
    );
  }

  private transportFor(operationId: string): 'cli' | 'batchmode' {
    return this.operations.get(operationId) ?? 'batchmode';
  }
}

export class FixtureUnityEngineAdapter extends InMemoryEngineAdapter {
  readonly executionMode = 'fixture' as const;
}
