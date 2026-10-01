import { createHash, randomUUID } from 'node:crypto';

export interface PlaytestEvidence {
  id: string;
  playtestRunId: string;
  assertionId?: string;
  kind:
    | 'state_sample'
    | 'console'
    | 'test_report'
    | 'frame'
    | 'video'
    | 'browser'
    | 'timing';
  sequence: number;
  timestampMs: number;
  summary: string;
  payload: Record<string, unknown>;
  contentHash: string;
}

export class EvidenceStore {
  private readonly evidence = new Map<string, PlaytestEvidence>();

  put(input: Omit<PlaytestEvidence, 'id' | 'contentHash'>): PlaytestEvidence {
    const contentHash = `sha256-${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
    const item = { ...input, id: randomUUID(), contentHash };
    this.evidence.set(item.id, structuredClone(item));
    return structuredClone(item);
  }

  get(id: string): PlaytestEvidence {
    const item = this.evidence.get(id);
    if (!item) throw new Error('EVIDENCE_NOT_FOUND');
    return structuredClone(item);
  }

  list(playtestRunId: string): PlaytestEvidence[] {
    return [...this.evidence.values()]
      .filter((item) => item.playtestRunId === playtestRunId)
      .map((item) => structuredClone(item));
  }
}
