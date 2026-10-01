import { randomUUID } from 'node:crypto';

export type SafetyClass =
  | 'read_only'
  | 'project_write'
  | 'destructive'
  | 'runtime'
  | 'build';
export interface EngineCapabilities {
  version: string;
  engineType: string;
  commands: string[];
  supports: Record<string, boolean>;
}
export interface ProjectRef {
  projectRef: string;
  path?: string;
}
export interface EngineExecutionContext {
  runId: string;
  taskId: string;
  traceId?: string;
  spanId?: string;
  workspaceRoot: string;
  capabilities: string[];
  checkpointRef?: string | undefined;
}
export interface EngineCommand {
  commandId: string;
  capability: string;
  safetyClass: SafetyClass;
  projectRef: string;
  expectedRevision?: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
}
export interface EngineDiagnostic {
  code: string;
  message: string;
  severity: 'warning' | 'error';
  details?: Record<string, unknown>;
}
export interface EngineCommandResult {
  operationId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  output?: unknown;
  changedFiles: string[];
  warnings: EngineDiagnostic[];
  errors: EngineDiagnostic[];
  evidenceRefs: string[];
  retryable: boolean;
  projectRevision?: string;
}
export interface CompileResult extends EngineCommandResult {
  diagnostics: EngineDiagnostic[];
  provenance: { transport: 'cli' | 'batchmode' };
}
export interface EngineTestRequest {
  projectRef: string;
  mode: 'editmode' | 'playmode';
  testFilter?: string;
}
export interface EngineTestResult extends EngineCommandResult {
  passed: number;
  failed: number;
}
export interface PlayModeRequest {
  projectRef: string;
  seed: number;
  fixedDeltaTimeMs: number;
}
export interface PlaySession {
  sessionId: string;
  status: 'started' | 'failed';
  transport: 'cli' | 'batchmode';
}
export interface WebBuildRequest {
  projectRef: string;
  outputPath: string;
}
export interface BuildArtifact extends EngineCommandResult {
  contentHash: string;
  artifactPath: string;
  provenance: Record<string, string>;
}
export interface EngineAdapter {
  readonly engineType: string;
  readonly adapterVersion: string;
  discoverCapabilities(): Promise<EngineCapabilities>;
  inspectProject(project: ProjectRef): Promise<Record<string, unknown>>;
  execute(
    command: EngineCommand,
    ctx: EngineExecutionContext,
  ): Promise<EngineCommandResult>;
  compile(
    project: ProjectRef,
    ctx: EngineExecutionContext,
  ): Promise<CompileResult>;
  runTests(
    request: EngineTestRequest,
    ctx: EngineExecutionContext,
  ): Promise<EngineTestResult>;
  startPlayMode(
    request: PlayModeRequest,
    ctx: EngineExecutionContext,
  ): Promise<PlaySession>;
  stopPlayMode(sessionId: string, ctx: EngineExecutionContext): Promise<void>;
  buildWeb(
    request: WebBuildRequest,
    ctx: EngineExecutionContext,
  ): Promise<BuildArtifact>;
  cancel(operationId: string): Promise<void>;
}

export class EngineAdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(`${code}: ${message}`);
    this.name = 'EngineAdapterError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateEngineCommand(command: EngineCommand): void {
  const path = command.arguments.path;
  if (
    typeof path === 'string' &&
    (path.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.split(/[\\/]/).includes('..') ||
      path.includes('\0'))
  )
    throw new EngineAdapterError(
      'WORKSPACE_ESCAPE',
      'Command path must stay inside the project workspace',
    );
  if (command.timeoutMs <= 0 || command.timeoutMs > 20 * 60 * 1000)
    throw new EngineAdapterError(
      'ENGINE_TIMEOUT',
      'Command timeout is outside the sandbox limit',
    );
}

export class InMemoryEngineAdapter implements EngineAdapter {
  readonly engineType = 'unity';
  readonly adapterVersion = 'fixture-1.0.0';
  private revision = 'rev-0';
  private readonly primaryAvailable: boolean;
  private readonly operations = new Set<string>();
  constructor(options: { primaryAvailable?: boolean } = {}) {
    this.primaryAvailable = options.primaryAvailable ?? true;
  }
  async discoverCapabilities(): Promise<EngineCapabilities> {
    return {
      version: this.adapterVersion,
      engineType: this.engineType,
      commands: [
        'scene.create',
        'scene.edit',
        'game_object.create',
        'prefab.create',
        'script.create',
        'asset.import',
        'ui.create',
        'component.set_property',
        'game_object.remove',
        'component.set_property',
        'compile',
        'play',
        'state.read',
        'test',
        'web.build',
      ],
      supports: { web_build: true, playmode: true, batchmode_fallback: true },
    };
  }
  async inspectProject(project: ProjectRef) {
    return {
      projectRef: project.projectRef,
      engineVersion: '6000.0.80f1',
      revision: this.revision,
      transport: this.primaryAvailable ? 'cli' : 'batchmode',
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
    if (command.expectedRevision && command.expectedRevision !== this.revision)
      throw new EngineAdapterError(
        'REVISION_CONFLICT',
        `Expected ${command.expectedRevision}, current ${this.revision}`,
      );
    const operationId = randomUUID();
    this.operations.add(operationId);
    if (command.safetyClass !== 'read_only')
      this.revision = `rev-${Number(this.revision.slice(4)) + 1}`;
    return {
      operationId,
      status: 'succeeded',
      changedFiles:
        typeof command.arguments.path === 'string' &&
        command.safetyClass !== 'read_only'
          ? [command.arguments.path]
          : [],
      warnings: [],
      errors: [],
      evidenceRefs: [],
      retryable: false,
      projectRevision: this.revision,
    };
  }
  async compile(
    _project: ProjectRef,
    _ctx: EngineExecutionContext,
  ): Promise<CompileResult> {
    void _project;
    void _ctx;
    const operationId = randomUUID();
    this.operations.add(operationId);
    return {
      operationId,
      status: 'succeeded',
      changedFiles: [],
      warnings: [],
      errors: [],
      evidenceRefs: [],
      retryable: false,
      projectRevision: this.revision,
      diagnostics: [],
      provenance: { transport: this.primaryAvailable ? 'cli' : 'batchmode' },
    };
  }
  async runTests(
    _request: EngineTestRequest,
    _ctx: EngineExecutionContext,
  ): Promise<EngineTestResult> {
    const operationId = randomUUID();
    this.operations.add(operationId);
    return {
      operationId,
      status: 'succeeded',
      changedFiles: [],
      warnings: [],
      errors: [],
      evidenceRefs: [],
      retryable: false,
      passed: 1,
      failed: 0,
    };
  }
  async startPlayMode(
    _request: PlayModeRequest,
    _ctx: EngineExecutionContext,
  ): Promise<PlaySession> {
    return {
      sessionId: randomUUID(),
      status: 'started',
      transport: this.primaryAvailable ? 'cli' : 'batchmode',
    };
  }
  async stopPlayMode(
    _sessionId: string,
    _ctx: EngineExecutionContext,
  ): Promise<void> {
    return undefined;
  }
  async buildWeb(
    request: WebBuildRequest,
    _ctx: EngineExecutionContext,
  ): Promise<BuildArtifact> {
    const operationId = randomUUID();
    this.operations.add(operationId);
    return {
      operationId,
      status: 'succeeded',
      changedFiles: [request.outputPath],
      warnings: [],
      errors: [],
      evidenceRefs: [],
      retryable: false,
      contentHash: `sha256-${randomUUID()}`,
      artifactPath: request.outputPath,
      provenance: {
        engineVersion: '6000.0.80f1',
        transport: this.primaryAvailable ? 'cli' : 'batchmode',
      },
    };
  }
  async cancel(operationId: string): Promise<void> {
    this.operations.delete(operationId);
  }
}
