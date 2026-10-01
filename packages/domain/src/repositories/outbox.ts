export interface EventOutboxRecord {
  id: string;
  run_id: string;
  sequence: number | string;
  event_type: string;
  trace_id: string;
  span_id: string;
  payload: Record<string, unknown>;
}

export interface EventOutboxStore {
  claimEventOutbox(limit?: number): Promise<EventOutboxRecord[]>;
  markEventOutboxPublished(id: string): Promise<void>;
}

export interface EventOutboxPublisher {
  publish(event: EventOutboxRecord): Promise<void>;
}

/** Publishes committed events only after their database transaction succeeds. */
export class TransactionalOutboxDispatcher {
  constructor(
    private readonly store: EventOutboxStore,
    private readonly publisher: EventOutboxPublisher,
  ) {}

  async drain(limit = 100): Promise<{ published: number; failed: number }> {
    const events = await this.store.claimEventOutbox(limit);
    let published = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await this.publisher.publish(event);
        await this.store.markEventOutboxPublished(event.id);
        published += 1;
      } catch {
        failed += 1;
      }
    }
    return { published, failed };
  }
}
