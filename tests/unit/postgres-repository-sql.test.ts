import {
  PostgresDomainRepository,
  type SqlClient,
  type SqlPool,
} from '@gamerhub/domain';
import { describe, expect, it } from 'vitest';

function runRow(status = 'planning') {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    project_id: '20000000-0000-4000-8000-000000000001',
    session_id: '30000000-0000-4000-8000-000000000001',
    trace_id: '1234567890abcdef1234567890abcdef',
    request_type: 'create',
    user_input: 'runner',
    status,
    fix_iteration: 0,
    max_fix_iterations: 5,
    idempotency_key: 'key',
    unresolved_issue_count: 0,
    created_at: new Date(0),
    updated_at: new Date(0),
    version: 1,
    workspace_repo_key: 'projects/test',
    quota_profile: 'runner-standard',
  };
}

describe('PostgresDomainRepository SQL contracts', () => {
  it('casts transition parameters to run_status consistently', async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      release: () => undefined,
      query: async (text) => {
        statements.push(text);
        if (text.includes('SELECT * FROM runs'))
          return { rows: [runRow('planning')] };
        if (text.includes('INSERT INTO run_events'))
          return {
            rows: [
              {
                run_id: runRow().id,
                sequence: 2,
                event_type: 'run.executing',
                visibility: 'developer',
                payload: {},
                trace_id: '1234567890abcdef1234567890abcdef',
                span_id: '1234567890abcdef',
                occurred_at: new Date(0),
              },
            ],
          };
        if (text.includes('UPDATE runs'))
          return { rows: [runRow('executing')] };
        return { rows: [] };
      },
    };
    const pool: SqlPool = {
      connect: async () => client,
      query: client.query,
    };
    const repository = new PostgresDomainRepository(pool);

    const result = await repository.transitionRun(runRow().id, 'executing', {
      eventType: 'run.executing',
      visibility: 'developer',
      payload: {},
    });

    const update = statements.find((text) => text.includes('UPDATE runs'));
    expect(update).toContain('status = $2::run_status');
    expect(update?.match(/\$2::run_status/g)).toHaveLength(3);
    expect(result.run.status).toBe('executing');
  });

  it('reclaims expired active Run leases after a worker restart', async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      release: () => undefined,
      query: async (text) => {
        statements.push(text);
        return { rows: [] };
      },
    };
    const repository = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });

    expect(await repository.claimNextRun('worker-recovery')).toBeUndefined();
    const claim = statements.find((text) => text.includes('SKIP LOCKED'));
    expect(claim).toContain("'planning', 'executing', 'playtesting'");
    expect(claim).toContain('lease_expires_at <= now()');
  });

  it('serializes the initial claim event with the Run row lock', async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      release: () => undefined,
      query: async (text) => {
        statements.push(text);
        if (text.includes('SELECT p.id'))
          return { rows: [{ id: runRow().project_id }] };
        if (text.includes('SELECT r.*')) return { rows: [runRow('queued')] };
        if (text.includes('UPDATE runs')) return { rows: [runRow('planning')] };
        return { rows: [] };
      },
    };
    const repository = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });

    expect(await repository.claimNextRun('worker-traced')).toMatchObject({
      status: 'planning',
      traceId: runRow().trace_id,
    });
    const lockIndex = statements.findIndex((text) =>
      text.includes('FOR UPDATE SKIP LOCKED'),
    );
    const eventIndex = statements.findIndex((text) =>
      text.includes('INSERT INTO run_events'),
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(eventIndex).toBeGreaterThan(lockIndex);
    expect(statements.some((text) => text.includes('pg_advisory'))).toBe(false);
  });

  it('locks the Run row before allocating an event sequence', async () => {
    const statements: string[] = [];
    const client: SqlClient = {
      release: () => undefined,
      query: async (text) => {
        statements.push(text);
        if (text.includes('SELECT trace_id FROM runs'))
          return { rows: [{ trace_id: runRow().trace_id }] };
        if (text.includes('COALESCE(MAX(sequence)'))
          return { rows: [{ sequence: 2 }] };
        if (text.includes('INSERT INTO run_events'))
          return {
            rows: [
              {
                run_id: runRow().id,
                sequence: 2,
                event_type: 'trace.redis.wakeup',
                visibility: 'creator',
                payload: {},
                trace_id: runRow().trace_id,
                span_id: '1234567890abcdef',
                occurred_at: new Date(0),
              },
            ],
          };
        return { rows: [] };
      },
    };
    const repository = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });

    await repository.appendEvent({
      runId: runRow().id,
      eventType: 'trace.redis.wakeup',
      visibility: 'creator',
      payload: {},
    });

    const lockIndex = statements.findIndex((text) =>
      text.includes('SELECT trace_id FROM runs WHERE id = $1 FOR UPDATE'),
    );
    const sequenceIndex = statements.findIndex((text) =>
      text.includes('COALESCE(MAX(sequence)'),
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(sequenceIndex).toBeGreaterThan(lockIndex);
    expect(statements.some((text) => text.includes('pg_advisory'))).toBe(false);
  });

  it('persists idempotent builds and atomically promotes their previews', async () => {
    const statements: string[] = [];
    const buildId = '40000000-0000-4000-8000-000000000001';
    const previewId = '50000000-0000-4000-8000-000000000001';
    const client: SqlClient = {
      release: () => undefined,
      query: async (text) => {
        statements.push(text);
        if (text.includes('INSERT INTO builds'))
          return { rows: [{ id: buildId }] };
        if (text.includes('SELECT id FROM builds'))
          return { rows: [{ id: buildId }] };
        if (text.includes('INSERT INTO previews'))
          return { rows: [{ id: previewId }] };
        return { rows: [] };
      },
    };
    const repository = new PostgresDomainRepository({
      connect: async () => client,
      query: client.query,
    });

    await repository.saveBuild({
      projectId: runRow().project_id,
      checkpointId: '60000000-0000-4000-8000-000000000001',
      specVersionId: '70000000-0000-4000-8000-000000000001',
      status: 'ready',
      engineVersion: '6000.0.80f1',
      adapterVersion: '1.0.0',
      templateVersion: 'runner-template-1.0.0',
      packageLockHash: 'sha256-lock',
      artifactKey: 'Builds/Web/run',
      contentHash: 'sha256-build',
    });
    const savedPreview = await repository.savePreview({
      projectId: runRow().project_id,
      buildContentHash: 'sha256-build',
      publicSlug: 'project/sha256-build',
      origin: 'http://127.0.0.1:3010',
    });

    expect(savedPreview).toBe(previewId);
    expect(
      statements.find((text) => text.includes('INSERT INTO builds')),
    ).toContain(
      'ON CONFLICT (project_id, checkpoint_id, spec_version_id, content_hash) DO UPDATE',
    );
    expect(
      statements.find((text) => text.includes("SET status = 'superseded'")),
    ).toContain("status IN ('provisioning', 'healthy')");
    expect(
      statements.find((text) => text.includes('INSERT INTO previews')),
    ).toContain('ON CONFLICT (project_id, build_id) DO UPDATE');
  });
});
