import { randomUUID } from 'node:crypto';

export interface StoredPlaytestRun {
  id: string;
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'inconclusive';
  seed: number;
  environment: Record<string, unknown>;
}
export interface StoredEvaluation {
  id: string;
  runId: string;
  playtestRunId: string;
  status: 'passed' | 'failed' | 'inconclusive';
  report: Record<string, unknown>;
}

export class EvaluationRepository {
  private readonly playtests = new Map<string, StoredPlaytestRun>();
  private readonly evidence = new Map<string, Record<string, unknown>>();
  private readonly reports = new Map<string, StoredEvaluation>();

  createPlaytest(input: Omit<StoredPlaytestRun, 'id'>): StoredPlaytestRun {
    const item = { ...input, id: randomUUID() };
    this.playtests.set(item.id, item);
    return structuredClone(item);
  }
  addEvidence(
    playtestRunId: string,
    evidence: Record<string, unknown>,
  ): string {
    const id = randomUUID();
    this.evidence.set(id, { id, playtestRunId, ...structuredClone(evidence) });
    return id;
  }
  saveReport(input: Omit<StoredEvaluation, 'id'>): StoredEvaluation {
    const item = { ...input, id: randomUUID() };
    this.reports.set(item.id, item);
    return structuredClone(item);
  }
  getReport(id: string): StoredEvaluation {
    const item = this.reports.get(id);
    if (!item) throw new Error('EVALUATION_NOT_FOUND');
    return structuredClone(item);
  }
}
