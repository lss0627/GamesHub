import { createHash, randomUUID } from 'node:crypto';
import type { RunEvent, RunStatus } from '../index';
import { assertRunTransition } from '../state-machines';

export type NewRunEvent = Omit<
  RunEvent,
  'sequence' | 'occurredAt' | 'schemaVersion'
> & { occurredAt?: string };

export function traceIdFromRunId(runId: string): string {
  const compact = runId.replaceAll('-', '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact)
    ? compact
    : createHash('sha256').update(runId).digest('hex').slice(0, 32);
}

export function createEventSpanId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

export class RunEventStore {
  private readonly events = new Map<string, RunEvent[]>();
  private readonly outbox: RunEvent[] = [];
  private readonly runStatuses = new Map<string, RunStatus>();
  private readonly runTraceIds = new Map<string, string>();

  registerRun(
    runId: string,
    status: RunStatus = 'queued',
    traceId = traceIdFromRunId(runId),
  ): void {
    this.runStatuses.set(runId, status);
    this.runTraceIds.set(runId, traceId);
    if (!this.events.has(runId)) this.events.set(runId, []);
  }

  restoreRun(
    runId: string,
    status: RunStatus,
    events: RunEvent[],
    traceId = traceIdFromRunId(runId),
  ): void {
    this.runStatuses.set(runId, status);
    this.runTraceIds.set(runId, traceId);
    this.events.set(
      runId,
      events
        .filter((event) => event.runId === runId)
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => structuredClone(event)),
    );
  }

  allEvents(): RunEvent[] {
    return [...this.events.values()]
      .flat()
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.sequence - right.sequence,
      )
      .map((event) => structuredClone(event));
  }

  append(input: NewRunEvent): RunEvent {
    const list = this.events.get(input.runId) ?? [];
    const event: RunEvent = {
      ...input,
      traceId:
        input.traceId ??
        this.runTraceIds.get(input.runId) ??
        traceIdFromRunId(input.runId),
      spanId: input.spanId ?? createEventSpanId(),
      schemaVersion: '1.0.0',
      sequence: (list.at(-1)?.sequence ?? 0) + 1,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };
    list.push(structuredClone(event));
    this.events.set(input.runId, list);
    this.outbox.push(structuredClone(event));
    return structuredClone(event);
  }

  transitionAndAppend(
    runId: string,
    nextStatus: RunStatus,
    input: Omit<NewRunEvent, 'runId' | 'eventType'> & { eventType?: string },
  ): RunEvent {
    const current = this.runStatuses.get(runId);
    if (!current) throw new Error(`Run ${runId} is not registered`);
    assertRunTransition(current, nextStatus);
    this.runStatuses.set(runId, nextStatus);
    return this.append({
      ...input,
      runId,
      eventType: input.eventType ?? 'run.status_changed',
      payload: {
        ...input.payload,
        previousStatus: current,
        currentStatus: nextStatus,
      },
    });
  }

  replay(
    runId: string,
    afterSequence = 0,
    visibility?: RunEvent['visibility'],
  ): RunEvent[] {
    return (this.events.get(runId) ?? [])
      .filter(
        (event) =>
          event.sequence > afterSequence &&
          (!visibility || event.visibility === visibility),
      )
      .map((event) => structuredClone(event));
  }

  drainOutbox(): RunEvent[] {
    const items = this.outbox.splice(0, this.outbox.length);
    return items.map((event) => structuredClone(event));
  }

  createRecoveryPoint(
    runId: string,
    reason: string,
  ): { id: string; runId: string; sequence: number; reason: string } {
    const sequence = this.events.get(runId)?.at(-1)?.sequence ?? 0;
    return { id: randomUUID(), runId, sequence, reason };
  }

  status(runId: string): RunStatus | undefined {
    return this.runStatuses.get(runId);
  }
}
