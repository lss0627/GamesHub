import type {
  AgentCheckpointStore,
  AgentEventSink,
  AgentKernelCheckpoint,
  AgentKernelEvent,
} from './types';

export class InMemoryAgentCheckpointStore implements AgentCheckpointStore {
  private readonly checkpoints = new Map<string, AgentKernelCheckpoint>();

  load(runId: string): Promise<AgentKernelCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(runId);
    return Promise.resolve(
      checkpoint ? structuredClone(checkpoint) : undefined,
    );
  }

  save(checkpoint: AgentKernelCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.runId, structuredClone(checkpoint));
    return Promise.resolve();
  }
}

export class InMemoryAgentEventSink implements AgentEventSink {
  readonly events: AgentKernelEvent[] = [];

  append(event: AgentKernelEvent): Promise<void> {
    this.events.push(structuredClone(event));
    return Promise.resolve();
  }
}
