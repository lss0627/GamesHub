import {
  type AgentCheckpointStore,
  type AgentEventSink,
  AgentKernel,
  type AgentKernelCheckpoint,
  type AgentKernelEvent,
  AgentRuntimeError,
} from '@gamerhub/agent-runtime';
import type { PlatformStore } from '@gamerhub/domain';

function checkpointFrom(value: unknown): AgentKernelCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const checkpoint = value as Partial<AgentKernelCheckpoint>;
  if (
    checkpoint.schemaVersion !== '1.0.0' ||
    typeof checkpoint.runId !== 'string' ||
    typeof checkpoint.sessionId !== 'string' ||
    typeof checkpoint.policyFingerprint !== 'string' ||
    !checkpoint.usage ||
    !checkpoint.actions
  )
    return undefined;
  return checkpoint as AgentKernelCheckpoint;
}

export class RunEventAgentCheckpointStore implements AgentCheckpointStore {
  constructor(private readonly store: PlatformStore) {}

  async load(runId: string): Promise<AgentKernelCheckpoint | undefined> {
    const events = await this.store.replayEvents(runId, 0);
    const latest = events
      .filter((event) => event.eventType === 'agent.checkpoint')
      .at(-1);
    if (!latest) return undefined;
    const checkpoint = checkpointFrom(latest.payload.checkpoint);
    if (!checkpoint)
      throw new AgentRuntimeError(
        'AGENT_CHECKPOINT_CORRUPT',
        'The latest Agent checkpoint is invalid',
      );
    return structuredClone(checkpoint);
  }

  async save(checkpoint: AgentKernelCheckpoint): Promise<void> {
    await this.store.appendEvent({
      runId: checkpoint.runId,
      eventType: 'agent.checkpoint',
      visibility: 'developer',
      ...(checkpoint.traceId ? { traceId: checkpoint.traceId } : {}),
      payload: { checkpoint: structuredClone(checkpoint) },
    });
  }
}

export class RunEventAgentEventSink implements AgentEventSink {
  constructor(private readonly store: PlatformStore) {}

  async append(event: AgentKernelEvent): Promise<void> {
    await this.store.appendEvent({
      runId: event.runId,
      eventType: event.type,
      visibility: event.visibility,
      occurredAt: event.occurredAt,
      ...(event.traceId ? { traceId: event.traceId } : {}),
      ...(event.spanId ? { spanId: event.spanId } : {}),
      payload: {
        sessionId: event.sessionId,
        ...event.payload,
      },
    });
  }
}

export function createRunEventAgentKernel(store: PlatformStore): AgentKernel {
  return new AgentKernel({
    checkpointStore: new RunEventAgentCheckpointStore(store),
    eventSink: new RunEventAgentEventSink(store),
  });
}
