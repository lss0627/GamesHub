import type { RunEventStore } from '@gamerhub/domain';

export function replayCreatorRunEvents(
  store: RunEventStore,
  runId: string,
  afterSequence = 0,
) {
  return store.replay(runId, afterSequence, 'creator').map((event) => ({
    id: event.sequence,
    event: event.eventType,
    data: structuredClone(event.payload),
    occurred_at: event.occurredAt,
  }));
}

export function formatRunEventsSse(
  events: ReturnType<typeof replayCreatorRunEvents>,
): string {
  return events
    .map(
      (event) =>
        `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n`,
    )
    .join('\n');
}
