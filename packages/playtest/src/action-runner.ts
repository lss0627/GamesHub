import { EvidenceStore, type PlaytestEvidence } from './evidence-store';
import type { PlaytestProtocolClient, ProbeResponse } from './probe-client';

export interface PlaytestAction {
  command: string;
  arguments?: Record<string, unknown>;
  deadlineMs?: number;
}

export async function executeActionTimeline(
  client: PlaytestProtocolClient,
  actions: PlaytestAction[],
  signal?: AbortSignal,
): Promise<ProbeResponse[]> {
  const responses: ProbeResponse[] = [];
  for (const action of actions) {
    if (signal?.aborted) break;
    const response = await client.send(
      action.command,
      action.arguments ?? {},
      action.deadlineMs ?? 5000,
      signal,
    );
    responses.push(response);
    if (response.status !== 'ok') break;
  }
  return responses;
}

export async function executeActionTimelineWithEvidence(
  client: PlaytestProtocolClient,
  playtestRunId: string,
  actions: PlaytestAction[],
  options: { evidenceStore?: EvidenceStore; signal?: AbortSignal } = {},
): Promise<{ responses: ProbeResponse[]; evidence: PlaytestEvidence[] }> {
  const evidenceStore = options.evidenceStore ?? new EvidenceStore();
  const responses = await executeActionTimeline(
    client,
    actions,
    options.signal,
  );
  const evidence = responses.flatMap((response, index) =>
    response.evidence_ids.map((evidenceId) =>
      evidenceStore.put({
        playtestRunId,
        kind:
          actions[index]?.command === 'frame.capture'
            ? 'frame'
            : 'state_sample',
        sequence: response.sequence,
        timestampMs: Date.now(),
        summary: `${actions[index]?.command ?? 'probe.command'} returned ${response.status}`,
        payload: {
          requestId: response.request_id,
          evidenceId,
          result: response.result,
          simulationTick: response.simulation_tick,
        },
      }),
    ),
  );
  return { responses, evidence };
}
