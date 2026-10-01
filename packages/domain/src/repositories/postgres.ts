import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Project, Run, RunEvent, RunStatus } from '../index';
import { assertRunTransition, StateTransitionError } from '../state-machines';
import type { TenantScope } from './index';
import type { EventOutboxRecord } from './outbox';
import {
  assertIdempotentRun,
  assertRunLease,
  type CreateRunInput,
  type PlatformStore,
  terminalRunPatch,
} from './platform-store';
import type { NewRunEvent } from './run-events';
import { createEventSpanId, traceIdFromRunId } from './run-events';

type DbRow = Record<string, unknown>;

export interface SqlResult<Row extends DbRow = DbRow> {
  rows: Row[];
  rowCount?: number | null;
}

export interface SqlExecutor {
  query<Row extends DbRow = DbRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlClient extends SqlExecutor {
  release(): void;
}

export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
  end?(): Promise<void>;
}

export interface DurableEvaluationInput {
  runId: string;
  playtestRunId: string;
  gameSpecVersionId: string;
  evaluatorVersion: string;
  status: string;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  reportKey: string;
}

export interface DurablePlaytestInput {
  runId: string;
  projectId: string;
  buildId?: string;
  mode: string;
  seed: number;
  fixedDeltaTimeMs: number;
  status: string;
  actionPlan: Record<string, unknown>;
  environmentSnapshot: Record<string, unknown>;
}

export interface DurableEvidenceInput {
  playtestRunId: string;
  assertionId: string;
  kind: string;
  sequence: number;
  timestampMs: number;
  summary: string;
  objectKey?: string;
  payload: Record<string, unknown>;
  contentHash: string;
}

export interface DurableEvaluationIssueInput {
  evaluationReportId: string;
  issueKey: string;
  assertionId: string;
  severity: string;
  category: string;
  description: string;
  expected: unknown;
  actual: unknown;
  evidenceIds: string[];
  affectedCapabilities: string[];
  retryable: boolean;
}

export interface DurableBuildInput {
  projectId: string;
  checkpointId: string;
  specVersionId: string;
  status: string;
  engineVersion: string;
  adapterVersion: string;
  templateVersion: string;
  packageLockHash: string;
  artifactKey?: string;
  contentHash?: string;
  sizeBytes?: number;
  evaluationReportId?: string;
  buildLogKey?: string;
}

export interface DurablePreviewInput {
  projectId: string;
  sourceRunId?: string;
  buildContentHash?: string;
  buildArtifactKey?: string;
  publicSlug: string;
  origin: string;
  status?: 'prepared' | 'provisioning' | 'healthy';
  expiresAt?: string;
}

export interface DurableAssetInput {
  projectId: string;
  type: string;
  name: string;
  source: string;
  sourceUri?: string;
  licenseId?: string;
  licenseText?: string;
  objectKey: string;
  contentHash: string;
  mediaType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
  securityStatus: string;
  importStatus: string;
  createdByRunId?: string;
}

export interface DurableCheckpointInput {
  projectId: string;
  specVersionId: string;
  sourceRunId: string;
  parentCheckpointId?: string;
  commitRef: string;
  summary: string;
  changeManifest: Record<string, unknown>;
  status: string;
}

function asString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

function rowToProject(row: DbRow): Project {
  return {
    id: asString(row.id),
    ownerId: asString(row.owner_id),
    name: asString(row.name),
    slug: asString(row.slug),
    status: row.status as Project['status'],
    engineType: 'unity',
    engineVersion: '6000.0.80f1',
    ...(row.current_spec_version_id
      ? { currentSpecVersionId: asString(row.current_spec_version_id) }
      : {}),
    ...(row.current_checkpoint_id
      ? { currentCheckpointId: asString(row.current_checkpoint_id) }
      : {}),
    ...(row.current_build_id
      ? { currentBuildId: asString(row.current_build_id) }
      : {}),
    workspaceRepoKey: asString(row.workspace_repo_key),
    quotaProfile: asString(row.quota_profile),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    version: Number(row.version),
  };
}

function rowToRun(row: DbRow): Run {
  const id = asString(row.id);
  return {
    id,
    projectId: asString(row.project_id),
    sessionId: asString(row.session_id),
    traceId: row.trace_id ? asString(row.trace_id) : traceIdFromRunId(id),
    ...(row.parent_run_id ? { parentRunId: asString(row.parent_run_id) } : {}),
    requestType: row.request_type as Run['requestType'],
    userInput: asString(row.user_input),
    status: row.status as RunStatus,
    fixIteration: Number(row.fix_iteration),
    maxFixIterations: Number(row.max_fix_iterations),
    idempotencyKey: asString(row.idempotency_key),
    ...(row.lease_owner ? { leaseOwner: asString(row.lease_owner) } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: asString(row.lease_expires_at) }
      : {}),
    ...(row.started_at ? { startedAt: asString(row.started_at) } : {}),
    ...(row.finished_at ? { finishedAt: asString(row.finished_at) } : {}),
    ...(row.result_summary
      ? { resultSummary: asString(row.result_summary) }
      : {}),
    unresolvedIssueCount: Number(row.unresolved_issue_count),
    ...(row.recovery_sequence != null
      ? { recoverySequence: Number(row.recovery_sequence) }
      : {}),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    version: Number(row.version),
  };
}

function rowToEvent(row: DbRow): RunEvent {
  return {
    runId: asString(row.run_id),
    sequence: Number(row.sequence),
    schemaVersion: '1.0.0',
    eventType: asString(row.event_type),
    visibility: row.visibility as RunEvent['visibility'],
    payload: asRecord(row.payload),
    occurredAt: asString(row.occurred_at),
    ...(row.trace_id ? { traceId: asString(row.trace_id) } : {}),
    ...(row.span_id ? { spanId: asString(row.span_id) } : {}),
  };
}

export class PostgresDomainRepository implements PlatformStore {
  readonly pool: SqlPool;

  constructor(pool: SqlPool) {
    this.pool = pool;
  }

  static fromConnectionString(
    connectionString: string,
  ): PostgresDomainRepository {
    if (!connectionString.trim()) throw new Error('DATABASE_URL_REQUIRED');
    const pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      application_name: 'gamerhub-control-plane',
    });
    return new PostgresDomainRepository(pool as unknown as SqlPool);
  }

  static fromEnvironment(): PostgresDomainRepository {
    return PostgresDomainRepository.fromConnectionString(
      process.env.DATABASE_URL ?? '',
    );
  }

  async withTenantTransaction<T>(
    ownerId: string,
    operation: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [
        ownerId,
      ]);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async withTransaction<T>(
    operation: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createProject(
    input: Pick<Project, 'ownerId' | 'name' | 'slug' | 'quotaProfile'>,
  ): Promise<Project> {
    return this.withTenantTransaction(input.ownerId, async (client) => {
      const result = await client.query(
        `INSERT INTO projects (owner_id, name, slug, workspace_repo_key, quota_profile)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.ownerId,
          input.name,
          input.slug,
          `projects/${input.ownerId}/${input.slug}`,
          input.quotaProfile,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('PROJECT_CREATE_FAILED');
      return rowToProject(row);
    });
  }

  async getProject(id: string, scope: TenantScope): Promise<Project> {
    return this.withTenantTransaction(scope.ownerId, async (client) => {
      const result = await client.query(
        'SELECT * FROM projects WHERE id = $1 AND owner_id = $2',
        [id, scope.ownerId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('NOT_FOUND');
      return rowToProject(row);
    });
  }

  async listProjects(scope: TenantScope): Promise<Project[]> {
    return this.withTenantTransaction(scope.ownerId, async (client) => {
      const result = await client.query(
        'SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at, id',
        [scope.ownerId],
      );
      return result.rows.map(rowToProject);
    });
  }

  async createRun(input: CreateRunInput): Promise<{
    run: Run;
    created: boolean;
  }> {
    return this.withTenantTransaction(input.ownerId, async (client) => {
      // Serialize project mutations before checking idempotency or active work.
      const project = await client.query(
        'SELECT id FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [input.projectId, input.ownerId],
      );
      if (!project.rows[0]) throw new Error('NOT_FOUND');
      const existingResult = await client.query(
        'SELECT r.* FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.project_id = $1 AND r.idempotency_key = $2 AND p.owner_id = $3',
        [input.projectId, input.idempotencyKey, input.ownerId],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const run = rowToRun(existing);
        assertIdempotentRun(run, input);
        return { run, created: false };
      }
      const active = await client.query(
        `SELECT id FROM runs WHERE project_id = $1 AND
         (status NOT IN ('succeeded', 'partially_succeeded', 'failed', 'cancelled', 'timed_out') OR lease_expires_at > now()) LIMIT 1`,
        [input.projectId],
      );
      if (active.rows[0])
        throw new StateTransitionError(
          'PROJECT_RUN_ACTIVE',
          'Project already has an unfinished run',
        );

      const sessionId = input.sessionId ?? randomUUID();
      await client.query(
        `INSERT INTO agent_sessions (id, project_id, runtime_type, runtime_session_ref, status, model_route_snapshot)
         VALUES ($1, $2, $3, $4, 'active', '{}'::jsonb)`,
        [
          sessionId,
          input.projectId,
          input.runtimeType ?? 'pi',
          `platform:${sessionId}`,
        ],
      );
      const runResult = await client.query(
        `INSERT INTO runs (project_id, session_id, request_type, user_input, idempotency_key, max_fix_iterations, trace_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
        [
          input.projectId,
          sessionId,
          input.requestType,
          input.userInput,
          input.idempotencyKey,
          input.maxFixIterations ?? 5,
          input.traceId ?? traceIdFromRunId(randomUUID()),
        ],
      );
      const row = runResult.rows[0];
      if (!row) throw new Error('RUN_CREATE_FAILED');
      const run = rowToRun(row);
      const acceptedSpanId = createEventSpanId();
      await client.query(
        `INSERT INTO run_events (run_id, sequence, event_type, visibility, payload, trace_id, span_id)
         VALUES ($1, 1, 'run.accepted', 'creator', $2::jsonb, $3, $4)`,
        [
          run.id,
          JSON.stringify({
            request_type: run.requestType,
            status: run.status,
            message: '已接受你的创作请求',
          }),
          run.traceId,
          acceptedSpanId,
        ],
      );
      await client.query(
        `INSERT INTO event_outbox (run_id, sequence, event_type, payload, trace_id, span_id)
         VALUES ($1, 1, 'run.accepted', $2::jsonb, $3, $4)
         ON CONFLICT (run_id, sequence) DO NOTHING`,
        [
          run.id,
          JSON.stringify({
            request_type: run.requestType,
            status: run.status,
            message: '已接受你的创作请求',
          }),
          run.traceId,
          acceptedSpanId,
        ],
      );
      return { run, created: true };
    });
  }

  async getRun(
    projectId: string,
    runId: string,
    scope: TenantScope,
  ): Promise<Run> {
    return this.withTenantTransaction(scope.ownerId, async (client) => {
      const result = await client.query(
        'SELECT r.* FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.id = $1 AND r.project_id = $2 AND p.owner_id = $3',
        [runId, projectId, scope.ownerId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('NOT_FOUND');
      return rowToRun(row);
    });
  }

  async getRunForWorker(runId: string): Promise<Run> {
    const result = await this.pool.query('SELECT * FROM runs WHERE id = $1', [
      runId,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error('NOT_FOUND');
    return rowToRun(row);
  }

  async listRuns(projectId: string, scope: TenantScope): Promise<Run[]> {
    return this.withTenantTransaction(scope.ownerId, async (client) => {
      const result = await client.query(
        'SELECT r.* FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.project_id = $1 AND p.owner_id = $2 ORDER BY r.created_at, r.id',
        [projectId, scope.ownerId],
      );
      return result.rows.map(rowToRun);
    });
  }

  async appendEvent(input: NewRunEvent): Promise<RunEvent> {
    return this.withTransaction(async (client) => {
      const runResult = await client.query(
        'SELECT trace_id FROM runs WHERE id = $1 FOR UPDATE',
        [input.runId],
      );
      const runTraceId = runResult.rows[0]?.trace_id;
      if (!runTraceId) throw new Error('NOT_FOUND');
      const next = await client.query(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = $1',
        [input.runId],
      );
      const sequence = Number(next.rows[0]?.sequence ?? 1);
      const result = await client.query(
        `INSERT INTO run_events (run_id, sequence, event_type, visibility, payload, trace_id, span_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [
          input.runId,
          sequence,
          input.eventType,
          input.visibility,
          JSON.stringify(input.payload),
          input.traceId ?? asString(runTraceId),
          input.spanId ?? createEventSpanId(),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('EVENT_APPEND_FAILED');
      await client.query(
        `INSERT INTO event_outbox (run_id, sequence, event_type, payload, trace_id, span_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (run_id, sequence) DO NOTHING`,
        [
          input.runId,
          sequence,
          input.eventType,
          JSON.stringify(input.payload),
          asString(row.trace_id),
          asString(row.span_id),
        ],
      );
      return rowToEvent(row);
    });
  }

  async transitionRun(
    runId: string,
    nextStatus: RunStatus,
    input: Omit<NewRunEvent, 'runId' | 'eventType'> & {
      eventType?: string;
    },
    expectedLeaseOwner?: string,
  ): Promise<{ run: Run; event: RunEvent }> {
    return this.withTransaction((client) =>
      this.transitionRunInTransaction(
        client,
        runId,
        nextStatus,
        input,
        expectedLeaseOwner,
      ),
    );
  }

  private async transitionRunInTransaction(
    client: SqlClient,
    runId: string,
    nextStatus: RunStatus,
    input: Parameters<PlatformStore['transitionRun']>[2],
    expectedLeaseOwner?: string,
    beforeTransition?: (current: Run) => Promise<void>,
  ): Promise<{ run: Run; event: RunEvent }> {
    const currentResult = await client.query(
      'SELECT * FROM runs WHERE id = $1 FOR UPDATE',
      [runId],
    );
    const currentRow = currentResult.rows[0];
    if (!currentRow) throw new Error('NOT_FOUND');
    const current = rowToRun(currentRow);
    assertRunLease(current, expectedLeaseOwner);
    assertRunTransition(current.status, nextStatus);
    await beforeTransition?.(current);
    const eventResult = await client.query(
      `INSERT INTO run_events (run_id, sequence, event_type, visibility, payload, trace_id, span_id)
         VALUES ($1, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3, $4::jsonb, $5, $6)
         RETURNING *`,
      [
        runId,
        input.eventType ?? 'run.status_changed',
        input.visibility,
        JSON.stringify({
          ...input.payload,
          previousStatus: current.status,
          currentStatus: nextStatus,
        }),
        input.traceId ?? current.traceId,
        input.spanId ?? createEventSpanId(),
      ],
    );
    const eventRow = eventResult.rows[0];
    if (!eventRow) throw new Error('EVENT_APPEND_FAILED');
    const updatedResult = await client.query(
      `UPDATE runs
         SET status = $2::run_status, updated_at = now(), version = version + 1,
             started_at = COALESCE(started_at, CASE WHEN $2::run_status IN ('planning', 'executing') THEN now() ELSE NULL END),
             finished_at = CASE WHEN $2::run_status IN ('succeeded', 'partially_succeeded', 'failed', 'cancelled', 'timed_out') THEN now() ELSE finished_at END,
             result_summary = COALESCE($3, result_summary)
         WHERE id = $1
         RETURNING *`,
      [
        runId,
        nextStatus,
        terminalRunPatch(nextStatus, input.payload).resultSummary ?? null,
      ],
    );
    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) throw new Error('RUN_UPDATE_FAILED');
    await client.query(
      `INSERT INTO event_outbox (run_id, sequence, event_type, payload, trace_id, span_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (run_id, sequence) DO NOTHING`,
      [
        runId,
        eventRow.sequence,
        input.eventType ?? 'run.status_changed',
        JSON.stringify({
          ...input.payload,
          previousStatus: current.status,
          currentStatus: nextStatus,
        }),
        asString(eventRow.trace_id),
        asString(eventRow.span_id),
      ],
    );
    return { run: rowToRun(updatedRow), event: rowToEvent(eventRow) };
  }

  async replayEvents(
    runId: string,
    afterSequence: number,
    visibility?: RunEvent['visibility'],
  ): Promise<RunEvent[]> {
    const values: unknown[] = [runId, afterSequence];
    const visibilityClause = visibility ? ' AND visibility = $3' : '';
    if (visibility) values.push(visibility);
    const result = await this.pool.query(
      `SELECT * FROM run_events WHERE run_id = $1 AND sequence > $2${visibilityClause} ORDER BY sequence`,
      values,
    );
    return result.rows.map(rowToEvent);
  }

  async commitRunPublication(input: {
    projectId: string;
    runId: string;
    workerId: string;
    specVersionId: string;
    previewId: string;
    previewUrl: string;
    evidenceCount: number;
  }): Promise<Run> {
    const url = new URL(input.previewUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('PREVIEW_URL_INVALID');
    return this.withTransaction(async (client) => {
      const project = await client.query(
        'SELECT id FROM projects WHERE id = $1 FOR UPDATE',
        [input.projectId],
      );
      if (!project.rows[0]) throw new Error('NOT_FOUND');
      const result = await this.transitionRunInTransaction(
        client,
        input.runId,
        'succeeded',
        {
          eventType: 'run.succeeded',
          visibility: 'creator',
          payload: {
            previewUrl: input.previewUrl,
            previewId: input.previewId,
            specVersionId: input.specVersionId,
            evidenceCount: input.evidenceCount,
          },
        },
        input.workerId,
        async (run) => {
          if (run.projectId !== input.projectId)
            throw new Error('PUBLICATION_PROJECT_MISMATCH');
          const preview = await client.query(
            `SELECT p.id, p.origin, b.id AS build_id, b.checkpoint_id FROM previews p
           JOIN builds b ON b.id = p.build_id
           JOIN checkpoints c ON c.id = b.checkpoint_id
           WHERE p.id = $1 AND p.project_id = $2 AND b.project_id = $2
             AND b.spec_version_id = $3 AND b.status = 'ready'
             AND c.project_id = $2 AND c.source_run_id = $4
             AND p.status IN ('prepared', 'healthy')
           FOR UPDATE OF p, b`,
            [
              input.previewId,
              input.projectId,
              input.specVersionId,
              input.runId,
            ],
          );
          const prepared = preview.rows[0];
          if (!prepared) throw new Error('PUBLICATION_EVIDENCE_MISMATCH');
          if (new URL(asString(prepared.origin)).origin !== url.origin)
            throw new Error('PREVIEW_ORIGIN_MISMATCH');
          const spec = await client.query(
            'SELECT id FROM game_spec_versions WHERE id = $1 AND project_id = $2 FOR UPDATE',
            [input.specVersionId, input.projectId],
          );
          if (!spec.rows[0]) throw new Error('SPEC_VERSION_NOT_FOUND');
          await client.query(
            "UPDATE game_spec_versions SET status = 'superseded', updated_at = now(), version = version + 1 WHERE project_id = $1 AND status = 'active' AND id <> $2",
            [input.projectId, input.specVersionId],
          );
          await client.query(
            "UPDATE game_spec_versions SET status = 'active', updated_at = now(), version = version + 1 WHERE id = $1",
            [input.specVersionId],
          );
          await client.query(
            "UPDATE previews SET status = 'superseded' WHERE project_id = $1 AND id <> $2 AND status IN ('healthy', 'provisioning')",
            [input.projectId, input.previewId],
          );
          await client.query(
            "UPDATE previews SET status = 'healthy', health_checked_at = now(), published_at = now() WHERE id = $1",
            [input.previewId],
          );
          await client.query(
            "UPDATE projects SET current_spec_version_id = $2, current_build_id = $3, current_checkpoint_id = $4, status = 'playable', updated_at = now(), version = version + 1 WHERE id = $1",
            [
              input.projectId,
              input.specVersionId,
              prepared.build_id,
              prepared.checkpoint_id,
            ],
          );
        },
      );
      const released = await client.query(
        'UPDATE runs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > clock_timestamp() RETURNING *',
        [input.runId, input.workerId],
      );
      if (!released.rows[0])
        throw new StateTransitionError(
          'RUN_LEASE_LOST',
          'Publication lease expired before commit',
        );
      return {
        ...result.run,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      };
    });
  }

  async updateRun(
    runId: string,
    patch: Parameters<PlatformStore['updateRun']>[1],
    expectedLeaseOwner?: string,
  ): Promise<Run> {
    const allowed: Array<[keyof typeof patch, string]> = [
      ['status', 'status'],
      ['leaseOwner', 'lease_owner'],
      ['leaseExpiresAt', 'lease_expires_at'],
      ['startedAt', 'started_at'],
      ['finishedAt', 'finished_at'],
      ['resultSummary', 'result_summary'],
      ['unresolvedIssueCount', 'unresolved_issue_count'],
      ['recoverySequence', 'recovery_sequence'],
    ];
    const entries = allowed.filter(([key]) => Object.hasOwn(patch, key));
    if (entries.length === 0) return this.getRunForWorker(runId);
    const assignments = entries.map(
      ([, column], index) => `${column} = $${index + 2}`,
    );
    const values: unknown[] = [
      runId,
      ...entries.map(([key]) => patch[key] ?? null),
    ];
    const leaseClause =
      expectedLeaseOwner === undefined
        ? ''
        : ` AND lease_owner = $${values.push(expectedLeaseOwner)} AND lease_expires_at > now()`;
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE runs SET ${assignments.join(', ')}, updated_at = now(), version = version + 1 WHERE id = $1${leaseClause} RETURNING *`,
        values,
      );
      const row = result.rows[0];
      if (!row)
        throw new StateTransitionError(
          expectedLeaseOwner === undefined ? 'NOT_FOUND' : 'RUN_LEASE_LOST',
          'Run update was not accepted',
        );
      return rowToRun(row);
    });
  }

  async claimNextRun(
    workerId: string,
    leaseSeconds = 60,
  ): Promise<Run | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Project -> Run is the shared lock order for admission, claims and publication.
      const project = await client.query(
        `SELECT p.id FROM projects p
         WHERE EXISTS (
           SELECT 1 FROM runs r WHERE r.project_id = p.id AND
           ((r.status IN ('queued', 'waiting_for_engine') AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now()))
            OR (r.status IN ('planning', 'executing', 'playtesting', 'evaluating', 'fixing', 'pause_requested') AND r.lease_expires_at <= now()))
         ) AND NOT EXISTS (
           SELECT 1 FROM runs busy WHERE busy.project_id = p.id
             AND (busy.status = 'paused' OR busy.lease_expires_at > now())
         )
         ORDER BY p.created_at, p.id
         FOR UPDATE OF p SKIP LOCKED LIMIT 1`,
      );
      if (!project.rows[0]) {
        await client.query('COMMIT');
        return undefined;
      }
      const result = await client.query(
        `SELECT r.* FROM runs r
         WHERE r.project_id = $1 AND NOT EXISTS (
           SELECT 1 FROM runs busy WHERE busy.project_id = r.project_id
             AND (busy.status = 'paused' OR busy.lease_expires_at > now())
         ) AND ((r.status IN ('queued', 'waiting_for_engine') AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= now()))
            OR (
              r.status IN ('planning', 'executing', 'playtesting', 'evaluating', 'fixing', 'pause_requested')
              AND r.lease_expires_at IS NOT NULL
              AND r.lease_expires_at <= now()
            ))
         ORDER BY r.created_at, r.id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [project.rows[0].id],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return undefined;
      }
      const current = rowToRun(row);
      const nextStatus: RunStatus =
        current.status === 'queued'
          ? 'planning'
          : current.status === 'pause_requested'
            ? 'pause_requested'
            : 'executing';
      const transitioned = await client.query(
        `UPDATE runs SET status = $2, lease_owner = $3,
             lease_expires_at = now() + ($4::integer * interval '1 second'),
             started_at = COALESCE(started_at, now()), updated_at = now(), version = version + 1
         WHERE id = $1 RETURNING *`,
        [current.id, nextStatus, workerId, leaseSeconds],
      );
      const claimSpanId = createEventSpanId();
      await client.query(
        `INSERT INTO run_events (run_id, sequence, event_type, visibility, payload, trace_id, span_id)
         VALUES ($1, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = $1), 'run.status_changed', 'creator', $2::jsonb, $3, $4)`,
        [
          current.id,
          JSON.stringify({
            previousStatus: current.status,
            currentStatus: nextStatus,
            message: '正在准备游戏计划',
          }),
          current.traceId,
          claimSpanId,
        ],
      );
      await client.query(
        `INSERT INTO event_outbox (run_id, sequence, event_type, payload, trace_id, span_id)
         VALUES ($1, (SELECT MAX(sequence) FROM run_events WHERE run_id = $1), 'run.status_changed', $2::jsonb, $3, $4)
         ON CONFLICT (run_id, sequence) DO NOTHING`,
        [
          current.id,
          JSON.stringify({
            previousStatus: current.status,
            currentStatus: nextStatus,
            message: '正在准备游戏计划',
          }),
          current.traceId,
          claimSpanId,
        ],
      );
      await client.query('COMMIT');
      const transitionedRow = transitioned.rows[0];
      return transitionedRow ? rowToRun(transitionedRow) : undefined;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveEvaluationReport(input: DurableEvaluationInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO evaluation_reports
          (run_id, playtest_run_id, game_spec_version_id, evaluator_version, status,
           passed_count, failed_count, inconclusive_count, report_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.runId,
          input.playtestRunId,
          input.gameSpecVersionId,
          input.evaluatorVersion,
          input.status,
          input.passedCount,
          input.failedCount,
          input.inconclusiveCount,
          input.reportKey,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('EVALUATION_PERSIST_FAILED');
      return asString(id);
    });
  }

  async createPlaytestRun(input: DurablePlaytestInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO playtest_runs
          (run_id, project_id, build_id, mode, seed, fixed_delta_time_ms, status,
           action_plan, environment_snapshot, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
         RETURNING id`,
        [
          input.runId,
          input.projectId,
          input.buildId ?? null,
          input.mode,
          input.seed,
          input.fixedDeltaTimeMs,
          input.status,
          JSON.stringify(input.actionPlan),
          JSON.stringify(input.environmentSnapshot),
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('PLAYTEST_PERSIST_FAILED');
      return asString(id);
    });
  }

  async updatePlaytestRun(
    playtestRunId: string,
    status: string,
  ): Promise<void> {
    await this.withTransaction((client) =>
      client
        .query(
          `UPDATE playtest_runs
           SET status = $2,
               finished_at = CASE
                 WHEN $2 IN ('passed', 'failed', 'cancelled') THEN now()
                 ELSE finished_at
               END
           WHERE id = $1`,
          [playtestRunId, status],
        )
        .then(() => undefined),
    );
  }

  async savePlaytestEvidence(input: DurableEvidenceInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO playtest_evidence
          (playtest_run_id, assertion_id, kind, sequence, timestamp_ms, summary,
           object_key, payload_json, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id`,
        [
          input.playtestRunId,
          input.assertionId,
          input.kind,
          input.sequence,
          input.timestampMs,
          input.summary,
          input.objectKey ?? null,
          JSON.stringify(input.payload),
          input.contentHash,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('PLAYTEST_EVIDENCE_PERSIST_FAILED');
      return asString(id);
    });
  }

  async saveEvaluationIssue(
    input: DurableEvaluationIssueInput,
  ): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO evaluation_issues
          (evaluation_report_id, issue_key, assertion_id, severity, category,
           description, expected, actual, evidence_ids, affected_capabilities, retryable)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::uuid[], $10, $11)
         ON CONFLICT (evaluation_report_id, issue_key) DO UPDATE
           SET resolution_status = 'open'
         RETURNING id`,
        [
          input.evaluationReportId,
          input.issueKey,
          input.assertionId,
          input.severity,
          input.category,
          input.description,
          JSON.stringify(input.expected),
          JSON.stringify(input.actual),
          input.evidenceIds,
          input.affectedCapabilities,
          input.retryable,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('EVALUATION_ISSUE_PERSIST_FAILED');
      return asString(id);
    });
  }

  async saveBuild(input: DurableBuildInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO builds
          (project_id, checkpoint_id, spec_version_id, target, status, engine_version,
           adapter_version, template_version, package_lock_hash, artifact_key,
           content_hash, size_bytes, evaluation_report_id, build_log_key)
         VALUES ($1, $2, $3, 'unity_web', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (project_id, checkpoint_id, spec_version_id, content_hash) DO UPDATE
           SET status = EXCLUDED.status,
               artifact_key = EXCLUDED.artifact_key,
               size_bytes = COALESCE(EXCLUDED.size_bytes, builds.size_bytes),
               evaluation_report_id = COALESCE(
                 EXCLUDED.evaluation_report_id,
                 builds.evaluation_report_id
               ),
               build_log_key = COALESCE(EXCLUDED.build_log_key, builds.build_log_key),
               updated_at = now(),
               version = builds.version + 1
         RETURNING id`,
        [
          input.projectId,
          input.checkpointId,
          input.specVersionId,
          input.status,
          input.engineVersion,
          input.adapterVersion,
          input.templateVersion,
          input.packageLockHash,
          input.artifactKey ?? null,
          input.contentHash ?? null,
          input.sizeBytes ?? null,
          input.evaluationReportId ?? null,
          input.buildLogKey ?? null,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('BUILD_PERSIST_FAILED');
      return asString(id);
    });
  }

  async savePreview(input: DurablePreviewInput): Promise<string> {
    return this.withTransaction(async (client) => {
      if (!input.buildContentHash && !input.buildArtifactKey)
        throw new Error('PREVIEW_BUILD_REFERENCE_REQUIRED');
      const build = await client.query(
        `SELECT id FROM builds
         WHERE project_id = $1
           AND ($4::uuid IS NULL OR checkpoint_id IN (SELECT id FROM checkpoints WHERE source_run_id = $4))
           AND (
             ($2::text IS NOT NULL AND content_hash = $2)
             OR ($3::text IS NOT NULL AND artifact_key = $3)
           )
         ORDER BY created_at DESC
         LIMIT 1`,
        [
          input.projectId,
          input.buildContentHash ?? null,
          input.buildArtifactKey ?? null,
          input.sourceRunId ?? null,
        ],
      );
      const buildId = build.rows[0]?.id;
      if (!buildId) throw new Error('PREVIEW_BUILD_NOT_FOUND');
      if (input.status !== 'prepared')
        await client.query(
          `UPDATE previews
         SET status = 'superseded'
         WHERE project_id = $1
           AND build_id <> $2
           AND status IN ('provisioning', 'healthy')`,
          [input.projectId, buildId],
        );
      const result = await client.query(
        `INSERT INTO previews
          (project_id, build_id, status, public_slug, origin,
           health_checked_at, published_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, now(), now(), $6)
         ON CONFLICT (project_id, build_id) DO UPDATE
           SET status = CASE WHEN EXCLUDED.status = 'prepared' AND previews.status = 'healthy' THEN previews.status ELSE EXCLUDED.status END,
               public_slug = EXCLUDED.public_slug,
               origin = EXCLUDED.origin,
               health_checked_at = now(),
               published_at = COALESCE(previews.published_at, now()),
               expires_at = EXCLUDED.expires_at
         RETURNING id`,
        [
          input.projectId,
          buildId,
          input.status ?? 'healthy',
          input.publicSlug,
          input.origin,
          input.expiresAt ?? null,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('PREVIEW_PERSIST_FAILED');
      return asString(id);
    });
  }

  async saveAsset(input: DurableAssetInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO assets
          (project_id, type, name, source, source_uri, license_id, license_text,
           object_key, content_hash, media_type, size_bytes, width, height, metadata,
           security_status, import_status, created_by_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
         RETURNING id`,
        [
          input.projectId,
          input.type,
          input.name,
          input.source,
          input.sourceUri ?? null,
          input.licenseId ?? null,
          input.licenseText ?? null,
          input.objectKey,
          input.contentHash,
          input.mediaType,
          input.sizeBytes,
          input.width ?? null,
          input.height ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.securityStatus,
          input.importStatus,
          input.createdByRunId ?? null,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('ASSET_PERSIST_FAILED');
      return asString(id);
    });
  }

  async saveCheckpoint(input: DurableCheckpointInput): Promise<string> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO checkpoints
          (project_id, game_spec_version_id, source_run_id, parent_checkpoint_id,
           commit_ref, summary, change_manifest, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id`,
        [
          input.projectId,
          input.specVersionId,
          input.sourceRunId,
          input.parentCheckpointId ?? null,
          input.commitRef,
          input.summary,
          JSON.stringify(input.changeManifest),
          input.status,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('CHECKPOINT_PERSIST_FAILED');
      return asString(id);
    });
  }

  async claimEventOutbox(limit = 100): Promise<EventOutboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('OUTBOX_LIMIT_INVALID');
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT * FROM event_outbox
         WHERE status = 'pending' AND available_at <= now()
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      const rows = result.rows;
      for (const row of rows)
        await client.query(
          `UPDATE event_outbox
           SET attempts = attempts + 1,
               available_at = now() + interval '1 minute'
           WHERE id = $1`,
          [row.id],
        );
      return rows.map((row) => ({
        id: asString(row.id),
        run_id: asString(row.run_id),
        sequence: Number(row.sequence),
        event_type: asString(row.event_type),
        trace_id: asString(row.trace_id),
        span_id: asString(row.span_id),
        payload: asRecord(row.payload),
      }));
    });
  }

  async markEventOutboxPublished(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE event_outbox SET status = 'published', published_at = now() WHERE id = $1`,
      [id],
    );
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }
}
