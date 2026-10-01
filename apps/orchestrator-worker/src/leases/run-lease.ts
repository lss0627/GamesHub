import type { Run, RunStatus } from '@gamerhub/domain';

export interface RunLeaseStore {
  claimNext(workerId: string, ttlSeconds: number): Promise<Run | undefined>;
  renew(runId: string, workerId: string, ttlSeconds: number): Promise<Run>;
  release(runId: string, workerId: string): Promise<Run>;
  enqueue(run: Run): Promise<Run>;
}
export class RunLeaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class InMemoryRunLeaseStore implements RunLeaseStore {
  private readonly runs = new Map<string, Run>();
  async enqueue(run: Run): Promise<Run> {
    const existing = [...this.runs.values()].find(
      (item) =>
        item.idempotencyKey === run.idempotencyKey &&
        item.projectId === run.projectId,
    );
    if (existing) return structuredClone(existing);
    this.runs.set(run.id, structuredClone(run));
    return structuredClone(run);
  }
  async claimNext(
    workerId: string,
    ttlSeconds: number,
  ): Promise<Run | undefined> {
    const now = Date.now();
    const candidate = [...this.runs.values()].find(
      (run) =>
        (run.status === 'queued' || run.status === 'paused') &&
        (!run.leaseExpiresAt || Date.parse(run.leaseExpiresAt) <= now),
    );
    if (!candidate) return undefined;
    candidate.leaseOwner = workerId;
    candidate.leaseExpiresAt = new Date(now + ttlSeconds * 1000).toISOString();
    candidate.status =
      candidate.status === 'paused' ? 'waiting_for_engine' : 'planning';
    candidate.version += 1;
    candidate.updatedAt = new Date().toISOString();
    this.runs.set(candidate.id, candidate);
    return structuredClone(candidate);
  }
  async renew(
    runId: string,
    workerId: string,
    ttlSeconds: number,
  ): Promise<Run> {
    const run = this.runs.get(runId);
    if (!run || run.leaseOwner !== workerId)
      throw new RunLeaseError(
        'LEASE_NOT_FOUND',
        'Run lease is not owned by this worker',
      );
    run.leaseExpiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    run.updatedAt = new Date().toISOString();
    run.version += 1;
    return structuredClone(run);
  }
  async release(runId: string, workerId: string): Promise<Run> {
    const run = this.runs.get(runId);
    if (!run || run.leaseOwner !== workerId)
      throw new RunLeaseError(
        'LEASE_NOT_FOUND',
        'Run lease is not owned by this worker',
      );
    run.leaseOwner = undefined;
    run.leaseExpiresAt = undefined;
    run.updatedAt = new Date().toISOString();
    run.version += 1;
    return structuredClone(run);
  }
  get(runId: string): Run | undefined {
    return this.runs.has(runId)
      ? structuredClone(this.runs.get(runId) as Run)
      : undefined;
  }
  setStatus(runId: string, status: RunStatus): Run {
    const run = this.runs.get(runId);
    if (!run) throw new RunLeaseError('NOT_FOUND', 'Run not found');
    run.status = status;
    run.version += 1;
    run.updatedAt = new Date().toISOString();
    this.runs.set(runId, run);
    return structuredClone(run);
  }
}
