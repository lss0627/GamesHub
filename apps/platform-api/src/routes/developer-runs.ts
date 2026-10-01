import { redact } from '@gamerhub/observability';

export function queryDeveloperRunTrace(
  events: Array<{
    runId: string;
    sequence: number;
    eventType: string;
    payload: Record<string, unknown>;
    traceId?: string;
  }>,
  input: {
    runId: string;
    role: 'creator' | 'developer' | 'operator' | 'admin';
  },
): Array<Record<string, unknown>> {
  if (!['developer', 'operator', 'admin'].includes(input.role))
    throw new Error('PROJECT_FORBIDDEN');
  return events
    .filter((event) => event.runId === input.runId)
    .map((event) => ({
      run_id: event.runId,
      sequence: event.sequence,
      type: event.eventType,
      trace_id: event.traceId ?? null,
      payload: redact(event.payload),
    }));
}
