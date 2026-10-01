import { randomUUID } from 'node:crypto';
import type { Project, Run, RunEvent, RunStatus } from '../index';
import { StateTransitionError, terminalRunStatuses } from '../state-machines';
import { InMemoryProjectRepository, type TenantScope } from './index';
import {
  type NewRunEvent,
  RunEventStore,
  traceIdFromRunId,
} from './run-events';

export interface CreateRunInput {
  ownerId: string;
  projectId: string;
  requestType: Run['requestType'];
  userInput: string;
  idempotencyKey: string;
  sessionId?: string;
  runtimeType?: string;
  maxFixIterations?: number;
  traceId?: string;
}

export function assertRunLease(run: Run, owner?: string): void {
  if (
    owner !== undefined &&
    (run.leaseOwner !== owner ||
      !run.leaseExpiresAt ||
      Date.parse(run.leaseExpiresAt) <= Date.now())
  )
    throw new StateTransitionError(
      'RUN_LEASE_LOST',
      'Run lease is no longer owned by this worker',
    );
}

export function assertIdempotentRun(run: Run, input: CreateRunInput): void {
  if (
    run.requestType !== input.requestType ||
    run.userInput !== input.userInput
  )
    throw new StateTransitionError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for a different request',
    );
}

export function terminalRunPatch(
  status: RunStatus,
  payload: Record<string, unknown>,
): Partial<Run> {
  if (!terminalRunStatuses.has(status)) return {};
  const summary = status === 'succeeded' ? payload.previewUrl : payload.message;
  return {
    finishedAt: timestamp(),
    ...(typeof summary === 'string' ? { resultSummary: summary } : {}),
  };
}

export interface PlatformStore {
  createProject(
    input: Pick<Project, 'ownerId' | 'name' | 'slug' | 'quotaProfile'>,
  ): Promise<Project>;
  getProject(id: string, scope: TenantScope): Promise<Project>;
  listProjects(scope: TenantScope): Promise<Project[]>;
  createRun(input: CreateRunInput): Promise<{ run: Run; created: boolean }>;
  claimNextRun(
    workerId: string,
    leaseSeconds?: number,
  ): Promise<Run | undefined>;
  getRun(projectId: string, runId: string, scope: TenantScope): Promise<Run>;
  getRunForWorker(runId: string): Promise<Run>;
  listRuns(projectId: string, scope: TenantScope): Promise<Run[]>;
  transitionRun(
    runId: string,
    nextStatus: RunStatus,
    input: Omit<NewRunEvent, 'runId' | 'eventType'> & {
      eventType?: string;
    },
    expectedLeaseOwner?: string,
  ): Promise<{ run: Run; event: RunEvent }>;
  appendEvent(input: NewRunEvent): Promise<RunEvent>;
  replayEvents(
    runId: string,
    afterSequence: number,
    visibility?: RunEvent['visibility'],
  ): Promise<RunEvent[]>;
  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        Run,
        | 'status'
        | 'leaseOwner'
        | 'leaseExpiresAt'
        | 'startedAt'
        | 'finishedAt'
        | 'resultSummary'
        | 'unresolvedIssueCount'
        | 'recoverySequence'
      >
    >,
    expectedLeaseOwner?: string,
  ): Promise<Run>;
}

export interface InMemoryPlatformStoreSnapshot {
  schemaVersion: '1.0.0';
  projects: Project[];
  runs: Run[];
  events: RunEvent[];
}

function timestamp(): string {
  return new Date().toISOString();
}

export class InMemoryPlatformStore implements PlatformStore {
  private readonly projects = new InMemoryProjectRepository();
  private readonly runs = new Map<string, Run>();
  private readonly events = new RunEventStore();

  constructor(snapshot?: InMemoryPlatformStoreSnapshot) {
    if (!snapshot) return;
    if (snapshot.schemaVersion !== '1.0.0')
      throw new Error('LOCAL_PLATFORM_SNAPSHOT_VERSION_INVALID');
    for (const project of snapshot.projects)
      this.projects.restoreProject(project);
    for (const persistedRun of snapshot.runs) {
      const recoverable = [
        'planning',
        'waiting_for_engine',
        'executing',
        'playtesting',
        'evaluating',
        'fixing',
      ].includes(persistedRun.status);
      const run: Run =
        persistedRun.status === 'pause_requested'
          ? {
              ...persistedRun,
              traceId:
                persistedRun.traceId ?? traceIdFromRunId(persistedRun.id),
              leaseExpiresAt: new Date(0).toISOString(),
            }
          : recoverable
            ? {
                ...persistedRun,
                traceId:
                  persistedRun.traceId ?? traceIdFromRunId(persistedRun.id),
                status: 'queued',
                leaseOwner: undefined,
                leaseExpiresAt: undefined,
              }
            : {
                ...persistedRun,
                traceId:
                  persistedRun.traceId ?? traceIdFromRunId(persistedRun.id),
              };
      this.runs.set(run.id, structuredClone(run));
      this.events.restoreRun(
        run.id,
        run.status,
        snapshot.events.filter((event) => event.runId === run.id),
        run.traceId,
      );
    }
  }

  snapshot(): InMemoryPlatformStoreSnapshot {
    return {
      schemaVersion: '1.0.0',
      projects: this.projects.allProjects(),
      runs: [...this.runs.values()].map((run) => structuredClone(run)),
      events: this.events.allEvents(),
    };
  }

  createProject(
    input: Pick<Project, 'ownerId' | 'name' | 'slug' | 'quotaProfile'>,
  ): Promise<Project> {
    return Promise.resolve(this.projects.createProject(input));
  }

  getProject(id: string, scope: TenantScope): Promise<Project> {
    return Promise.resolve(this.projects.getProject(id, scope));
  }

  listProjects(scope: TenantScope): Promise<Project[]> {
    return Promise.resolve(this.projects.listProjects(scope));
  }

  async createRun(input: CreateRunInput): Promise<{
    run: Run;
    created: boolean;
  }> {
    await this.getProject(input.projectId, { ownerId: input.ownerId });
    const existing = [...this.runs.values()].find(
      (run) =>
        run.projectId === input.projectId &&
        run.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      assertIdempotentRun(existing, input);
      return { run: structuredClone(existing), created: false };
    }
    if (
      [...this.runs.values()].some(
        (run) =>
          run.projectId === input.projectId &&
          (!terminalRunStatuses.has(run.status) ||
            (run.leaseExpiresAt &&
              Date.parse(run.leaseExpiresAt) > Date.now())),
      )
    )
      throw new StateTransitionError(
        'PROJECT_RUN_ACTIVE',
        'Project already has an unfinished run',
      );
    const now = timestamp();
    const runId = randomUUID();
    const run: Run = {
      id: runId,
      projectId: input.projectId,
      sessionId: input.sessionId ?? randomUUID(),
      traceId: input.traceId ?? traceIdFromRunId(runId),
      requestType: input.requestType,
      userInput: input.userInput,
      status: 'queued',
      fixIteration: 0,
      maxFixIterations: input.maxFixIterations ?? 5,
      idempotencyKey: input.idempotencyKey,
      unresolvedIssueCount: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.runs.set(run.id, run);
    this.events.registerRun(run.id, run.status, run.traceId);
    this.events.append({
      runId: run.id,
      eventType: 'run.accepted',
      visibility: 'creator',
      payload: {
        request_type: run.requestType,
        status: run.status,
        message: '已接受你的创作请求',
      },
    });
    return { run: structuredClone(run), created: true };
  }

  async getRun(
    projectId: string,
    runId: string,
    scope: TenantScope,
  ): Promise<Run> {
    await this.getProject(projectId, scope);
    const run = this.runs.get(runId);
    if (!run || run.projectId !== projectId) throw new Error('NOT_FOUND');
    return structuredClone(run);
  }

  getRunForWorker(runId: string): Promise<Run> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('NOT_FOUND');
    return Promise.resolve(structuredClone(run));
  }

  async claimNextRun(
    workerId: string,
    leaseSeconds = 60,
  ): Promise<Run | undefined> {
    const now = Date.now();
    const candidate = [...this.runs.values()]
      .filter(
        (run) =>
          ![...this.runs.values()].some(
            (other) =>
              other.id !== run.id &&
              other.projectId === run.projectId &&
              (other.status === 'paused' ||
                (other.leaseExpiresAt &&
                  Date.parse(other.leaseExpiresAt) > now)),
          ) &&
          (run.status === 'queued' ||
            run.status === 'waiting_for_engine' ||
            ([
              'planning',
              'executing',
              'playtesting',
              'evaluating',
              'fixing',
              'pause_requested',
            ].includes(run.status) &&
              Boolean(run.leaseExpiresAt))) &&
          (!run.leaseExpiresAt || Date.parse(run.leaseExpiresAt) <= now),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!candidate) return undefined;
    const nextStatus =
      candidate.status === 'queued'
        ? 'planning'
        : candidate.status === 'pause_requested'
          ? 'pause_requested'
          : 'executing';
    const payload = {
      workerId,
      previousStatus: candidate.status,
      currentStatus: nextStatus,
    };
    // Lease recovery may resume an executing phase without a user state transition.
    const result =
      candidate.status === 'queued' || candidate.status === 'waiting_for_engine'
        ? this.events.transitionAndAppend(candidate.id, nextStatus, {
            visibility: 'developer',
            payload: {
              workerId,
              previousStatus: candidate.status,
              currentStatus: nextStatus,
              message: '正在准备游戏计划',
            },
          })
        : this.events.append({
            runId: candidate.id,
            eventType: 'run.recovered',
            visibility: 'developer',
            payload,
          });
    if (
      candidate.status !== nextStatus &&
      candidate.status !== 'queued' &&
      candidate.status !== 'waiting_for_engine'
    )
      this.events.restoreRun(
        candidate.id,
        nextStatus,
        this.events.replay(candidate.id, 0),
        candidate.traceId,
      );
    const claimed: Run = {
      ...candidate,
      status: nextStatus,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(),
      startedAt: candidate.startedAt ?? timestamp(),
      updatedAt: result.occurredAt,
      version: candidate.version + 1,
    };
    this.runs.set(claimed.id, claimed);
    return structuredClone(claimed);
  }

  async listRuns(projectId: string, scope: TenantScope): Promise<Run[]> {
    await this.getProject(projectId, scope);
    return [...this.runs.values()]
      .filter((run) => run.projectId === projectId)
      .map((run) => structuredClone(run));
  }

  async transitionRun(
    runId: string,
    nextStatus: RunStatus,
    input: Omit<NewRunEvent, 'runId' | 'eventType'> & {
      eventType?: string;
    },
    expectedLeaseOwner?: string,
  ): Promise<{ run: Run; event: RunEvent }> {
    const current = this.runs.get(runId);
    if (!current) throw new Error('NOT_FOUND');
    assertRunLease(current, expectedLeaseOwner);
    const event = this.events.transitionAndAppend(runId, nextStatus, input);
    const run: Run = {
      ...current,
      status: nextStatus,
      ...terminalRunPatch(nextStatus, input.payload),
      updatedAt: event.occurredAt,
      version: current.version + 1,
    };
    this.runs.set(runId, run);
    return { run: structuredClone(run), event };
  }

  appendEvent(input: NewRunEvent): Promise<RunEvent> {
    if (!this.runs.has(input.runId)) throw new Error('NOT_FOUND');
    return Promise.resolve(this.events.append(input));
  }

  replayEvents(
    runId: string,
    afterSequence: number,
    visibility?: RunEvent['visibility'],
  ): Promise<RunEvent[]> {
    return Promise.resolve(
      this.events.replay(runId, afterSequence, visibility),
    );
  }

  getRunOrThrow(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) throw new Error('NOT_FOUND');
    return run;
  }

  async updateRun(
    runId: string,
    patch: Parameters<PlatformStore['updateRun']>[1],
    expectedLeaseOwner?: string,
  ): Promise<Run> {
    const current = this.getRunOrThrow(runId);
    assertRunLease(current, expectedLeaseOwner);
    const run: Run = {
      ...current,
      ...patch,
      updatedAt: timestamp(),
      version: current.version + 1,
    };
    this.runs.set(runId, run);
    return structuredClone(run);
  }
}
