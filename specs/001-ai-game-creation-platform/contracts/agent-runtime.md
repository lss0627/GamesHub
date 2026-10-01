# Agent Runtime Contract

## Purpose

隔离 Game Orchestrator 与 DeepSeek Harness、Pi 或未来 runtime。领域层不得引用 vendor session/event/tool types。

## Interface

```ts
interface AgentRuntime {
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
  getContext(runId: string): Promise<AgentContextSnapshot>;
  closeSession(sessionId: string): Promise<void>;
}

type PauseTaskInput = {
  runId: string;
  reason: string;
  signal?: AbortSignal;
};

type PauseResult = {
  status: "pause_requested" | "paused" | "pause_pending";
  checkpointSequence: number;
  releasedExclusiveResources: boolean;
};
```

## Required Semantics

- `createSession` is idempotent on platform `session_id` and returns an opaque vendor reference.
- `runTask` accepts a platform `run_id`, immutable task text, model role, allowed tools/skills, workspace ref, cancellation signal and event cursor.
- `pauseTask` is cooperative. It never interrupts an in-flight Unity write, compile, test or build; once the safe boundary is reached the adapter commits a recovery cursor, quiesces model/tool activity and reports `paused`.
- `resumeTask` resumes from committed platform state and vendor session when supported; an adapter may reconstruct vendor context from the canonical snapshot but must emit `runtime.session_reconstructed`.
- Event sequences are strictly increasing per Run. Duplicate vendor events are deduplicated before leaving the adapter.
- `cancelTask` is idempotent and resolves only when model/tool execution has stopped or is explicitly reported `cancel_pending`.
- Tools are registered from the platform registry. A runtime cannot add model-visible tools that bypass `GameToolGateway`.
- Runtime errors use the shared error envelope and never leak secrets, raw credentials or host paths.
- Adapter disposal flushes committed events before returning. Unflushed events cause a retryable runtime error, not false success.
- A pause request that cannot yet reach a safe boundary reports `pause_pending`; it must not be represented as terminal success or as a released lease.

## Inputs

```ts
type RunTaskInput = {
  runId: string;
  sessionId: string;
  taskId?: string;
  prompt: string;
  workspaceRef: string;
  modelRole: "planner" | "coder" | "vision" | "evaluator";
  allowedToolNames: string[];
  allowedSkillNames: string[];
  contextSnapshot: AgentContextSnapshot;
  afterEventSequence?: number;
  signal: AbortSignal;
};
```

## Event Envelope

```ts
type AgentEvent = {
  schemaVersion: "1.0.0";
  runId: string;
  sequence: number;
  type: string;
  visibility: "creator" | "developer" | "operator" | "audit";
  occurredAt: string;
  payload: unknown;
  traceId?: string;
};
```

Minimum event types: `runtime.session_created`, `runtime.session_resumed`, `runtime.session_reconstructed`, `runtime.turn_started`, `runtime.text_delta`, `runtime.tool_requested`, `runtime.tool_completed`, `runtime.usage`, `runtime.cancelled`, `runtime.failed`, `runtime.quiescent`.

## Contract Tests

1. Same `session_id` create is idempotent.
2. Run events are ordered, deduplicated and resumable after process restart.
3. Cancel during model streaming and during tool execution reaches quiescence.
4. Unregistered or disallowed tools are rejected before execution.
5. Provider timeout, malformed tool args and runtime crash map to stable error codes.
6. No vendor type appears in serialized Project/Run/Task state.
7. Adapter version upgrade can resume a pinned golden session or fails with an explicit migration error.

## Error Codes

`RUNTIME_UNAVAILABLE`, `SESSION_NOT_FOUND`, `SESSION_INCOMPATIBLE`, `EVENT_GAP`, `TOOL_NOT_ALLOWED`, `CANCEL_TIMEOUT`, `CONTEXT_INVALID`, `RUNTIME_CRASHED`, `RUNTIME_VERSION_UNSUPPORTED`.
