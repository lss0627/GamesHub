import { randomUUID } from 'node:crypto';
import {
  InMemoryPlatformStore,
  type PlatformStore,
  type Project,
  type Run,
  type RunEvent,
  type RunStatus,
} from '@gamerhub/domain';
import {
  createSpanId,
  createTraceContext,
  formatTraceparent,
} from '@gamerhub/observability';
import type { RequestIdentity } from './middleware/auth';

export interface PlatformRequest {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface PlatformResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface PlatformApiOptions {
  store?: PlatformStore;
  onRunAccepted?: (
    run: Run,
  ) =>
    | undefined
    | { transport: string; delivered: boolean }
    | Promise<undefined | { transport: string; delivered: boolean }>;
}

function publicProject(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: project.status,
    engine_type: project.engineType,
    engine_version: project.engineVersion,
    current_spec_version_id: project.currentSpecVersionId ?? null,
    current_build_id: project.currentBuildId ?? null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

export function publicRun(run: Run): Record<string, unknown> {
  return {
    id: run.id,
    project_id: run.projectId,
    trace_id: run.traceId,
    request_type: run.requestType,
    status: run.status,
    fix_iteration: run.fixIteration,
    max_fix_iterations: run.maxFixIterations,
    unresolved_issue_count: run.unresolvedIssueCount,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    started_at: run.startedAt ?? null,
    finished_at: run.finishedAt ?? null,
    result_summary: run.resultSummary ?? null,
  };
}

function traceHeaders(traceId: string): Record<string, string> {
  const context = { traceId, spanId: createSpanId() };
  return {
    traceparent: formatTraceparent(context),
    'x-gamerhub-trace-id': traceId,
  };
}

function traceComponent(event: RunEvent): string {
  if (event.eventType === 'run.accepted') return 'api-postgresql';
  if (event.eventType === 'trace.redis.wakeup') return 'redis';
  if (event.eventType.startsWith('agent.')) return 'agent';
  if (event.eventType === 'task.progress') return 'unity';
  if (event.eventType === 'run.succeeded') return 'preview';
  return 'orchestrator';
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object'
    ? (body as Record<string, unknown>)
    : {};
}

function parsePath(path: string): {
  segments: string[];
  query: URLSearchParams;
} {
  const url = new URL(path, 'http://gamerhub.local');
  return {
    segments: url.pathname.split('/').filter(Boolean),
    query: url.searchParams,
  };
}

export class PlatformApi {
  private readonly store: PlatformStore;
  private readonly onRunAccepted:
    | PlatformApiOptions['onRunAccepted']
    | undefined;

  constructor(
    private readonly identity: Pick<RequestIdentity, 'userId' | 'role'>,
    options: PlatformApiOptions = {},
  ) {
    this.store = options.store ?? new InMemoryPlatformStore();
    this.onRunAccepted = options.onRunAccepted;
  }

  async request(request: PlatformRequest): Promise<PlatformResponse> {
    try {
      const { segments, query } = parsePath(request.path);
      if (segments[0] !== 'v1') return this.error(404, 'NOT_FOUND');
      if (
        request.method === 'POST' &&
        segments.length === 2 &&
        segments[1] === 'projects'
      )
        return await this.createProject(bodyRecord(request.body));
      if (segments.length === 2 && segments[1] === 'projects')
        return await this.listProjects();
      if (segments[1] !== 'projects') return this.error(404, 'NOT_FOUND');
      const projectId = segments[2];
      if (!projectId) return this.error(404, 'NOT_FOUND');
      if (segments.length === 3 && request.method === 'GET')
        return await this.getProject(projectId);
      if (segments[3] === 'runs') {
        if (segments.length === 4 && request.method === 'POST')
          return await this.createRun(projectId, request);
        if (segments.length === 4 && request.method === 'GET')
          return await this.listRuns(projectId);
        const runId = segments[4];
        if (!runId) return this.error(404, 'NOT_FOUND');
        if (segments.length === 5 && request.method === 'GET')
          return await this.getRun(projectId, runId);
        if (
          segments.length === 6 &&
          request.method === 'GET' &&
          segments[5] === 'events'
        )
          return await this.listEvents(
            projectId,
            runId,
            Number(query.get('after') ?? 0),
          );
        if (
          segments.length === 6 &&
          request.method === 'GET' &&
          segments[5] === 'trace'
        )
          return await this.getTrace(projectId, runId);
        if (segments.length === 6 && request.method === 'POST') {
          const action = segments[5];
          if (action === 'pause')
            return await this.pauseRun(
              projectId,
              runId,
              bodyRecord(request.body),
            );
          if (action === 'resume')
            return await this.resumeRun(projectId, runId);
          if (action === 'cancel')
            return await this.cancelRun(
              projectId,
              runId,
              bodyRecord(request.body),
            );
        }
      }
      return this.error(404, 'NOT_FOUND');
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : error instanceof Error
            ? error.message
            : 'BAD_REQUEST';
      if (
        [
          'PROJECT_RUN_ACTIVE',
          'IDEMPOTENCY_CONFLICT',
          'RUN_INVALID_TRANSITION',
          'RUN_LEASE_LOST',
        ].includes(code)
      )
        return this.error(409, code);
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'NOT_FOUND'
      )
        return this.error(404, 'NOT_FOUND');
      if (error instanceof Error && /not found/i.test(error.message))
        return this.error(404, 'NOT_FOUND');
      if (
        [
          'IDEMPOTENCY_KEY_REQUIRED',
          'INVALID_REQUEST_TYPE',
          'PROMPT_REQUIRED',
          'REQUEST_TOO_LARGE',
          'INVALID_PROJECT_NAME',
        ].includes(code)
      )
        return this.error(400, code);
      return this.error(500, 'INTERNAL_ERROR');
    }
  }

  private async createProject(
    body: Record<string, unknown>,
  ): Promise<PlatformResponse> {
    if (
      body.name !== undefined &&
      (typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 120)
    )
      throw new Error('INVALID_PROJECT_NAME');
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'Untitled Runner';
    const slug = `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'runner'
    }-${randomUUID().slice(0, 8)}`;
    const project = await this.store.createProject({
      ownerId: this.identity.userId,
      name,
      slug,
      quotaProfile: 'runner-standard',
    });
    return { status: 201, body: publicProject(project) };
  }

  private async listProjects(): Promise<PlatformResponse> {
    return {
      status: 200,
      body: {
        items: (
          await this.store.listProjects({ ownerId: this.identity.userId })
        ).map(publicProject),
        next_cursor: null,
      },
    };
  }

  private async getProject(projectId: string): Promise<PlatformResponse> {
    return {
      status: 200,
      body: publicProject(
        await this.store.getProject(projectId, {
          ownerId: this.identity.userId,
        }),
      ),
    };
  }

  private async createRun(
    projectId: string,
    request: PlatformRequest,
  ): Promise<PlatformResponse> {
    const project = await this.store.getProject(projectId, {
      ownerId: this.identity.userId,
    });
    const input = bodyRecord(request.body);
    const key =
      request.headers?.['Idempotency-Key'] ??
      request.headers?.['idempotency-key'];
    if (!key?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const requestType = input.request_type;
    if (
      requestType !== 'create' &&
      requestType !== 'modify' &&
      requestType !== 'rollback'
    )
      throw new Error('INVALID_REQUEST_TYPE');
    if (typeof input.prompt !== 'string' || !input.prompt.trim())
      throw new Error('PROMPT_REQUIRED');
    if (input.prompt.length > 20_000 || key.length > 200)
      throw new Error('REQUEST_TOO_LARGE');
    const result = await this.store.createRun({
      ownerId: this.identity.userId,
      projectId: project.id,
      requestType,
      userInput: input.prompt,
      idempotencyKey: key,
      sessionId: randomUUID(),
      traceId: createTraceContext(
        request.headers?.traceparent,
        request.headers?.['x-gamerhub-trace-id'],
      ).traceId,
    });
    if (result.created) {
      let wakeup: undefined | { transport: string; delivered: boolean };
      try {
        wakeup = await this.onRunAccepted?.(result.run);
      } catch {
        wakeup = { transport: 'configured-signal', delivered: false };
      }
      await this.store
        .appendEvent({
          runId: result.run.id,
          eventType: 'trace.redis.wakeup',
          visibility: 'creator',
          traceId: result.run.traceId,
          payload: {
            component: 'redis',
            transport: wakeup?.transport ?? 'postgresql-polling',
            delivered: wakeup?.delivered ?? false,
            durableFallback: 'postgresql-skip-locked',
          },
        })
        .catch(() => undefined);
    }
    return {
      status: 202,
      headers: traceHeaders(result.run.traceId),
      body: publicRun(result.run),
    };
  }

  private async listRuns(projectId: string): Promise<PlatformResponse> {
    await this.store.getProject(projectId, {
      ownerId: this.identity.userId,
    });
    return {
      status: 200,
      body: {
        items: (
          await this.store.listRuns(projectId, {
            ownerId: this.identity.userId,
          })
        ).map(publicRun),
        next_cursor: null,
      },
    };
  }

  private async getRun(
    projectId: string,
    runId: string,
  ): Promise<PlatformResponse> {
    const run = await this.requireRun(projectId, runId);
    return {
      status: 200,
      headers: traceHeaders(run.traceId),
      body: publicRun(run),
    };
  }

  private async listEvents(
    projectId: string,
    runId: string,
    afterSequence: number,
  ): Promise<PlatformResponse> {
    const run = await this.requireRun(projectId, runId);
    const items = (
      await this.store.replayEvents(
        runId,
        Number.isFinite(afterSequence) ? Math.max(0, afterSequence) : 0,
        'creator',
      )
    ).map((event) => this.publicEvent(event));
    const sse = items
      .map(
        (event) =>
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n`,
      )
      .join('\n');
    return {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        ...traceHeaders(run.traceId),
      },
      body: {
        items,
        sse,
        next_cursor: items.at(-1)?.sequence ?? afterSequence,
      },
    };
  }

  private async getTrace(
    projectId: string,
    runId: string,
  ): Promise<PlatformResponse> {
    const run = await this.requireRun(projectId, runId);
    const events = await this.store.replayEvents(runId, 0, 'creator');
    const components = new Map<
      string,
      { startedAt: string; finishedAt: string; spanCount: number }
    >();
    for (const event of events) {
      const component = traceComponent(event);
      const current = components.get(component);
      components.set(component, {
        startedAt:
          !current || event.occurredAt < current.startedAt
            ? event.occurredAt
            : current.startedAt,
        finishedAt:
          !current || event.occurredAt > current.finishedAt
            ? event.occurredAt
            : current.finishedAt,
        spanCount: (current?.spanCount ?? 0) + 1,
      });
    }
    return {
      status: 200,
      headers: traceHeaders(run.traceId),
      body: {
        trace_id: run.traceId,
        run_id: run.id,
        project_id: run.projectId,
        status: run.status,
        started_at: run.startedAt ?? run.createdAt,
        finished_at: run.finishedAt ?? null,
        duration_ms: Math.max(
          0,
          Date.parse(run.finishedAt ?? new Date().toISOString()) -
            Date.parse(run.startedAt ?? run.createdAt),
        ),
        components: [...components.entries()].map(([name, value]) => ({
          name,
          started_at: value.startedAt,
          finished_at: value.finishedAt,
          duration_ms: Math.max(
            0,
            Date.parse(value.finishedAt) - Date.parse(value.startedAt),
          ),
          span_count: value.spanCount,
        })),
        spans: events.map((event) => ({
          span_id: event.spanId ?? null,
          sequence: event.sequence,
          name: event.eventType,
          component: traceComponent(event),
          status: /failed|cancelled|timed_out/.test(event.eventType)
            ? 'error'
            : 'ok',
          occurred_at: event.occurredAt,
        })),
      },
    };
  }

  private async pauseRun(
    projectId: string,
    runId: string,
    input: Record<string, unknown>,
  ): Promise<PlatformResponse> {
    let run = await this.requireRun(projectId, runId);
    if (run.status === 'paused' || run.status === 'pause_requested')
      return { status: 202, body: publicRun(run) };
    if (run.status === 'queued') {
      run = (await this.transition(run, 'planning', 'run.planning', {})).run;
    }
    if (
      ![
        'planning',
        'waiting_for_engine',
        'executing',
        'playtesting',
        'evaluating',
        'fixing',
      ].includes(run.status)
    )
      return {
        status: 409,
        body: { code: 'RUN_NOT_PAUSABLE', status: run.status },
      };
    run = (
      await this.transition(run, 'pause_requested', 'run.pause_requested', {
        reason:
          typeof input.reason === 'string' ? input.reason : 'creator_request',
      })
    ).run;
    // An executing worker must reach a tool boundary before acknowledging pause.
    if (run.leaseOwner) return { status: 202, body: publicRun(run) };
    const recoveryPoint = await this.store.appendEvent({
      runId: run.id,
      eventType: 'run.recovery_point',
      visibility: 'developer',
      payload: { reason: 'creator_pause', status: run.status },
    });
    run = (
      await this.transition(run, 'paused', 'run.paused', {
        recovery_sequence: recoveryPoint.sequence,
        resources_released: true,
      })
    ).run;
    run = await this.store.updateRun(run.id, {
      recoverySequence: recoveryPoint.sequence,
    });
    return { status: 202, body: publicRun(run) };
  }

  private async resumeRun(
    projectId: string,
    runId: string,
  ): Promise<PlatformResponse> {
    const run = await this.requireRun(projectId, runId);
    if (run.status !== 'paused')
      return {
        status: 409,
        body: { code: 'RUN_NOT_PAUSED', status: run.status },
      };
    const result = await this.transition(
      run,
      'waiting_for_engine',
      'run.resumed',
      {
        recovery_sequence: run.recoverySequence ?? 0,
      },
    );
    return { status: 202, body: publicRun(result.run) };
  }

  private async cancelRun(
    projectId: string,
    runId: string,
    input: Record<string, unknown>,
  ): Promise<PlatformResponse> {
    const run = await this.requireRun(projectId, runId);
    if (run.status === 'cancelled')
      return { status: 202, body: publicRun(run) };
    if (
      ['succeeded', 'failed', 'partially_succeeded', 'timed_out'].includes(
        run.status,
      )
    )
      return {
        status: 409,
        body: { code: 'RUN_TERMINAL', status: run.status },
      };
    const result = await this.transition(run, 'cancelled', 'run.cancelled', {
      reason:
        typeof input.reason === 'string' ? input.reason : 'creator_request',
    });
    return { status: 202, body: publicRun(result.run) };
  }

  private async transition(
    run: Run,
    next: RunStatus,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<{ run: Run; event: RunEvent }> {
    return this.store.transitionRun(run.id, next, {
      eventType,
      visibility: 'creator',
      payload,
    });
  }

  private async requireRun(projectId: string, runId: string): Promise<Run> {
    return this.store.getRun(projectId, runId, {
      ownerId: this.identity.userId,
    });
  }

  private publicEvent(event: RunEvent): Record<string, unknown> {
    return {
      sequence: event.sequence,
      schema_version: event.schemaVersion,
      run_id: event.runId,
      type: event.eventType,
      visibility: 'creator',
      occurred_at: event.occurredAt,
      trace_id: event.traceId ?? null,
      span_id: event.spanId ?? null,
      payload: structuredClone(event.payload),
    };
  }

  private error(status: number, code: string): PlatformResponse {
    return { status, body: { code } };
  }
}

export function createPlatformApi(
  identity: Pick<RequestIdentity, 'userId' | 'role'>,
  options: PlatformApiOptions = {},
): PlatformApi {
  return new PlatformApi(identity, options);
}
