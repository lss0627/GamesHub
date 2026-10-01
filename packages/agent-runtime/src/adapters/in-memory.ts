import { randomUUID } from 'node:crypto';
import type {
  AgentContextSnapshotResult,
  AgentEvent,
  AgentRuntime,
  AgentSessionHandle,
  AgentState,
  CancelResult,
  CancelTaskInput,
  CreateSessionInput,
  PauseResult,
  PauseTaskInput,
  ResumeTaskInput,
  RunTaskInput,
  RuntimeSkillDefinition,
  RuntimeToolDefinition,
} from '../ports/agent-runtime';
import { AgentRuntimeError } from '../ports/agent-runtime';

export class InMemoryAgentRuntime implements AgentRuntime {
  readonly runtimeType: string;
  readonly runtimeVersion = 'fixture-1.0.0';
  private readonly sessions = new Map<string, AgentSessionHandle>();
  private readonly states = new Map<string, AgentState>();
  private readonly contexts = new Map<string, AgentContextSnapshotResult>();
  private readonly events = new Map<string, AgentEvent[]>();
  private readonly tools = new Map<string, RuntimeToolDefinition>();
  private readonly skills = new Map<string, RuntimeSkillDefinition>();

  constructor(runtimeType = 'test') {
    this.runtimeType = runtimeType;
    this.registerTool({
      name: 'game.spec.read',
      version: '1.0.0',
      safetyClass: 'read_only',
      invoke: async (input) => input,
    });
  }

  async createSession(input: CreateSessionInput): Promise<AgentSessionHandle> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) return { ...existing };
    const handle = {
      sessionId: input.sessionId,
      runtimeSessionRef: `runtime:${randomUUID()}`,
      runtimeType: this.runtimeType,
    };
    this.sessions.set(input.sessionId, handle);
    return { ...handle };
  }

  registerTool(tool: RuntimeToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  registerSkill(skill: RuntimeSkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  async *runTask(input: RunTaskInput): AsyncIterable<AgentEvent> {
    this.requireSession(input.sessionId);
    this.validateInput(input);
    const state = this.states.get(input.runId) ?? {
      runId: input.runId,
      status: 'idle' as const,
      lastEventSequence: 0,
    };
    state.status = 'running';
    this.states.set(input.runId, state);
    this.contexts.set(input.runId, {
      runId: input.runId,
      ...input.contextSnapshot,
    });
    yield this.emit(input.runId, 'runtime.turn_started', {
      promptAccepted: true,
    });
    if (input.signal.aborted)
      throw new AgentRuntimeError(
        'CANCEL_TIMEOUT',
        'Task was cancelled before streaming',
      );
    yield this.emit(input.runId, 'runtime.text_delta', {
      text: 'Planning accepted.',
    });
    yield this.emit(input.runId, 'runtime.usage', {
      promptTokens: null,
      completionTokens: null,
      cachedTokens: null,
    });
    state.status = 'quiescent';
    yield this.emit(input.runId, 'runtime.quiescent', {
      reason: 'fixture_completed',
    });
  }

  async *resumeTask(input: ResumeTaskInput): AsyncIterable<AgentEvent> {
    this.requireSession(input.sessionId);
    const state = this.states.get(input.runId);
    if (state?.status !== 'paused' && state?.status !== 'quiescent')
      throw new AgentRuntimeError(
        'SESSION_INCOMPATIBLE',
        'Run is not resumable',
      );
    state.status = 'running';
    yield this.emit(input.runId, 'runtime.session_resumed', {
      afterEventSequence: input.afterEventSequence,
    });
    state.status = 'quiescent';
    yield this.emit(input.runId, 'runtime.quiescent', {
      reason: 'resume_checkpoint_replayed',
    });
  }

  async pauseTask(input: PauseTaskInput): Promise<PauseResult> {
    const state = this.states.get(input.runId) ?? {
      runId: input.runId,
      status: 'idle' as const,
      lastEventSequence: 0,
    };
    if (state.status === 'cancelled')
      return {
        status: 'pause_pending',
        checkpointSequence: state.lastEventSequence,
        releasedExclusiveResources: false,
      };
    state.status = 'paused';
    this.states.set(input.runId, state);
    this.emit(input.runId, 'runtime.session_paused', {
      reason: input.reason,
      safeBoundary: true,
    });
    return {
      status: 'paused',
      checkpointSequence: state.lastEventSequence,
      releasedExclusiveResources: true,
    };
  }

  async cancelTask(input: CancelTaskInput): Promise<CancelResult> {
    const state = this.states.get(input.runId) ?? {
      runId: input.runId,
      status: 'idle' as const,
      lastEventSequence: 0,
    };
    if (state.status !== 'cancelled') {
      state.status = 'cancelled';
      this.states.set(input.runId, state);
      this.emit(input.runId, 'runtime.cancelled', { reason: input.reason });
    }
    return { status: 'cancelled' };
  }

  async getState(runId: string): Promise<AgentState> {
    return {
      ...(this.states.get(runId) ?? {
        runId,
        status: 'idle',
        lastEventSequence: 0,
      }),
    };
  }
  async getContext(runId: string): Promise<AgentContextSnapshotResult> {
    return (
      this.contexts.get(runId) ?? { runId, schemaVersion: '1.0.0', values: {} }
    );
  }
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) this.sessions.delete(sessionId);
  }

  private requireSession(sessionId: string): void {
    if (!this.sessions.has(sessionId))
      throw new AgentRuntimeError(
        'SESSION_NOT_FOUND',
        `Session ${sessionId} does not exist`,
      );
  }

  private validateInput(input: RunTaskInput): void {
    for (const name of input.allowedToolNames)
      if (!this.tools.has(name))
        throw new AgentRuntimeError(
          'TOOL_NOT_ALLOWED',
          `Tool ${name} is not registered`,
        );
    for (const name of input.allowedSkillNames)
      if (!this.skills.has(name))
        throw new AgentRuntimeError(
          'TOOL_NOT_ALLOWED',
          `Skill ${name} is not registered`,
        );
  }

  private emit(runId: string, type: string, payload: unknown): AgentEvent {
    const state = this.states.get(runId) ?? {
      runId,
      status: 'idle' as const,
      lastEventSequence: 0,
    };
    const event: AgentEvent = {
      schemaVersion: '1.0.0',
      runId,
      sequence: state.lastEventSequence + 1,
      type,
      visibility: type === 'runtime.text_delta' ? 'creator' : 'developer',
      occurredAt: new Date().toISOString(),
      payload,
    };
    state.lastEventSequence = event.sequence;
    this.states.set(runId, state);
    const list = this.events.get(runId) ?? [];
    list.push(event);
    this.events.set(runId, list);
    return event;
  }
}
