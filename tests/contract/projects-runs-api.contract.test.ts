import { InMemoryPlatformStore } from '@gamerhub/domain';
import { describe, expect, it, vi } from 'vitest';
import { createPlatformApi } from '../../apps/platform-api/src/app';

describe('projects and runs API contract', () => {
  it('does not reject a durably accepted Run when optional wakeup tracing fails', async () => {
    const store = new InMemoryPlatformStore();
    const project = await store.createProject({
      ownerId: 'user',
      name: 'test',
      slug: 'test',
      quotaProfile: 'standard',
    });
    vi.spyOn(store, 'appendEvent').mockRejectedValue(
      new Error('trace unavailable'),
    );
    const api = createPlatformApi(
      { userId: 'user', role: 'creator' },
      { store },
    );
    const result = await api.request({
      method: 'POST',
      path: `/v1/projects/${project.id}/runs`,
      headers: { 'idempotency-key': 'accepted' },
      body: { request_type: 'create', prompt: 'runner' },
    });
    expect(result.status).toBe(202);
    expect(await store.listRuns(project.id, { ownerId: 'user' })).toHaveLength(
      1,
    );
  });
  it('creates a project, accepts an idempotent run and exposes creator-safe state', async () => {
    const api = createPlatformApi({ userId: 'user-1', role: 'creator' });
    const project = await api.request({
      method: 'POST',
      path: '/v1/projects',
      body: { name: 'Cat Runner' },
    });
    expect(project.status).toBe(201);
    const created = project.body as { id: string; engine_type: string };
    expect(created.engine_type).toBe('unity');
    const first = await api.request({
      method: 'POST',
      path: `/v1/projects/${created.id}/runs`,
      headers: {
        'Idempotency-Key': 'run-key-001',
        traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
      },
      body: {
        request_type: 'create',
        prompt: '做一个可以跳跃、躲避障碍物、收集金币的猫咪跑酷游戏。',
      },
    });
    const second = await api.request({
      method: 'POST',
      path: `/v1/projects/${created.id}/runs`,
      headers: { 'Idempotency-Key': 'run-key-001' },
      body: {
        request_type: 'create',
        prompt: '做一个可以跳跃、躲避障碍物、收集金币的猫咪跑酷游戏。',
      },
    });
    expect(first.status).toBe(202);
    expect(second.body).toEqual(first.body);
    const run = first.body as Record<string, unknown>;
    expect(run.trace_id).toBe('1234567890abcdef1234567890abcdef');
    expect(first.headers?.['x-gamerhub-trace-id']).toBe(run.trace_id);
    expect(['queued', 'planning']).toContain(run.status);
    expect(JSON.stringify(run)).not.toMatch(
      /C#|Unity command|workspace|token/i,
    );
    const trace = await api.request({
      method: 'GET',
      path: `/v1/projects/${created.id}/runs/${String(run.id)}/trace`,
    });
    expect(trace.status).toBe(200);
    expect(trace.body).toMatchObject({
      trace_id: run.trace_id,
      run_id: run.id,
    });
    const traceBody = trace.body as {
      components: Array<{ name: string }>;
      spans: Array<{ span_id: string; component: string }>;
    };
    expect(traceBody.components.map((item) => item.name)).toEqual(
      expect.arrayContaining(['api-postgresql', 'redis']),
    );
    expect(
      traceBody.spans.every((item) => /^[0-9a-f]{16}$/.test(item.span_id)),
    ).toBe(true);
  });

  it('supports pause, resume, cancel and cursor-based creator events', async () => {
    const api = createPlatformApi({ userId: 'user-1', role: 'creator' });
    const project = (
      await api.request({
        method: 'POST',
        path: '/v1/projects',
        body: { name: 'Events' },
      })
    ).body as { id: string };
    const run = (
      await api.request({
        method: 'POST',
        path: `/v1/projects/${project.id}/runs`,
        headers: { 'Idempotency-Key': 'run-key-002' },
        body: { request_type: 'create', prompt: 'runner' },
      })
    ).body as { id: string };
    expect(
      (
        await api.request({
          method: 'POST',
          path: `/v1/projects/${project.id}/runs/${run.id}/pause`,
          body: { reason: 'pause' },
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await api.request({
          method: 'POST',
          path: `/v1/projects/${project.id}/runs/${run.id}/resume`,
        })
      ).status,
    ).toBe(202);
    const events = await api.request({
      method: 'GET',
      path: `/v1/projects/${project.id}/runs/${run.id}/events`,
    });
    expect(events.status).toBe(200);
    expect((events.body as { items: unknown[] }).items.length).toBeGreaterThan(
      0,
    );
    expect(
      (
        await api.request({
          method: 'POST',
          path: `/v1/projects/${project.id}/runs/${run.id}/cancel`,
          body: { reason: 'done' },
        })
      ).status,
    ).toBe(202);
  });
});
