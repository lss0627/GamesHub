export type AgentKernelStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface AgentExecutionBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxRetriesPerAction: number;
  deadlineMs: number;
}

export interface AgentKernelPolicy {
  allowedToolNames: string[];
  allowedSafetyClasses: string[];
  budget: AgentExecutionBudget;
}

export interface AgentToolContext {
  runId: string;
  sessionId: string;
  actionId: string;
  attempt: number;
  traceId: string;
  spanId: string;
  signal: AbortSignal;
}

export interface AgentKernelTool<TInput = unknown, TOutput = unknown> {
  name: string;
  version: string;
  safetyClass: string;
  idempotent: boolean;
  timeoutMs?: number;
  invoke: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
}

export interface AgentActionAssessment {
  succeeded: boolean;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface AgentKernelAction<TInput = unknown, TOutput = unknown> {
  id: string;
  idempotencyKey: string;
  input: TInput;
  tool: AgentKernelTool<TInput, TOutput>;
  summarizeInput?: (input: TInput) => Record<string, unknown>;
  summarizeOutput?: (output: TOutput) => Record<string, unknown>;
  assess?: (output: TOutput) => AgentActionAssessment;
}

export interface AgentActionCheckpoint {
  actionId: string;
  idempotencyKey: string;
  toolName: string;
  toolVersion: string;
  status: 'running' | 'completed' | 'failed';
  attempts: number;
  startedAt: string;
  updatedAt: string;
  output?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export interface AgentKernelCheckpoint {
  schemaVersion: '1.0.0';
  runId: string;
  sessionId: string;
  traceId?: string;
  policyFingerprint: string;
  status: AgentKernelStatus;
  createdAt: string;
  updatedAt: string;
  usage: {
    steps: number;
    toolCalls: number;
    retries: number;
  };
  actions: Record<string, AgentActionCheckpoint>;
}

export interface AgentKernelEvent {
  schemaVersion: '1.0.0';
  runId: string;
  sessionId: string;
  type: string;
  visibility: 'creator' | 'developer' | 'operator' | 'audit';
  occurredAt: string;
  traceId?: string;
  spanId?: string;
  payload: Record<string, unknown>;
}

export interface AgentCheckpointStore {
  load(runId: string): Promise<AgentKernelCheckpoint | undefined>;
  save(checkpoint: AgentKernelCheckpoint): Promise<void>;
}

export interface AgentEventSink {
  append(event: AgentKernelEvent): Promise<void>;
}

export interface AgentKernelExecutionResult<TOutput> {
  output: TOutput;
  replayed: boolean;
  attempts: number;
  usage: AgentKernelCheckpoint['usage'];
}
