export type RuntimeRole = 'planner' | 'coder' | 'vision' | 'evaluator';

export interface AgentContextSnapshot {
  schemaVersion: '1.0.0';
  values: Record<string, unknown>;
}

export interface CreateSessionInput {
  sessionId: string;
  projectId: string;
  runtimeType: string;
}
export interface AgentSessionHandle {
  sessionId: string;
  runtimeSessionRef: string;
  runtimeType: string;
}
export interface RunTaskInput {
  runId: string;
  sessionId: string;
  taskId?: string;
  prompt: string;
  workspaceRef: string;
  modelRole: RuntimeRole;
  allowedToolNames: string[];
  allowedSkillNames: string[];
  contextSnapshot: AgentContextSnapshot;
  afterEventSequence?: number;
  signal: AbortSignal;
}
export interface ResumeTaskInput extends RunTaskInput {
  afterEventSequence: number;
}
export interface PauseTaskInput {
  runId: string;
  reason: string;
  signal?: AbortSignal;
}
export interface CancelTaskInput {
  runId: string;
  reason: string;
}
export interface PauseResult {
  status: 'pause_requested' | 'paused' | 'pause_pending';
  checkpointSequence: number;
  releasedExclusiveResources: boolean;
}
export interface CancelResult {
  status: 'cancelled' | 'cancel_pending';
}
export interface AgentEvent {
  schemaVersion: '1.0.0';
  runId: string;
  sequence: number;
  type: string;
  visibility: 'creator' | 'developer' | 'operator' | 'audit';
  occurredAt: string;
  payload: unknown;
  traceId?: string;
}
export interface AgentState {
  runId: string;
  status: 'idle' | 'running' | 'paused' | 'cancelled' | 'quiescent';
  lastEventSequence: number;
}
export interface AgentContextSnapshotResult extends AgentContextSnapshot {
  runId: string;
}
export interface RuntimeToolDefinition {
  name: string;
  version: string;
  safetyClass: string;
  invoke: (input: unknown) => Promise<unknown>;
}
export interface RuntimeSkillDefinition {
  name: string;
  version: string;
}

export interface AgentRuntime {
  readonly runtimeType: string;
  readonly runtimeVersion: string;
  createSession(input: CreateSessionInput): Promise<AgentSessionHandle>;
  runTask(input: RunTaskInput): AsyncIterable<AgentEvent>;
  pauseTask(input: PauseTaskInput): Promise<PauseResult>;
  resumeTask(input: ResumeTaskInput): AsyncIterable<AgentEvent>;
  cancelTask(input: CancelTaskInput): Promise<CancelResult>;
  registerTool(tool: RuntimeToolDefinition): void;
  registerSkill(skill: RuntimeSkillDefinition): void;
  getState(runId: string): Promise<AgentState>;
  getContext(runId: string): Promise<AgentContextSnapshotResult>;
  closeSession(sessionId: string): Promise<void>;
}

export class AgentRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.retryable = retryable;
  }
}
