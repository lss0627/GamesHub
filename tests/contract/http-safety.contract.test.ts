import { InMemoryPlatformStore } from '@gamerhub/domain';
import { describe, expect, it } from 'vitest';
import {
  createHttpServer,
  requireApiBearerToken,
} from '../../apps/platform-api/src/server';

describe('HTTP safety boundaries', () => {
  it('requires a replay key and returns 202 for queued version restores', async () => {
    const store = new InMemoryPlatformStore();
    const project = await store.createProject({
      ownerId: 'local-user',
      name: 'test',
      slug: 'restore',
      quotaProfile: 'standard',
    });
    const keys: Array<string | undefined> = [];
    const server = createHttpServer(undefined, {
      store,
      restoreService: {
        list: async () => [],
        restore: async (_project, _version, key) => {
          keys.push(key);
          return { id: 'rollback-run', status: 'queued' };
        },
      },
    });
    try {
      const request = {
        method: 'POST' as const,
        url: `/v1/projects/${project.id}/versions/version-1/restore`,
      };
      expect((await server.inject(request)).statusCode).toBe(400);
      const accepted = await server.inject({
        ...request,
        headers: { 'idempotency-key': 'restore-key' },
      });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({
        id: 'rollback-run',
        status: 'queued',
      });
      expect(keys).toEqual(['restore-key']);
    } finally {
      await server.close();
    }
  });
  it('rejects mutation verbs and treats HEAD as a read', async () => {
    const store = new InMemoryPlatformStore();
    const server = createHttpServer(
      { userId: 'user', role: 'creator' },
      { store },
    );
    try {
      for (const method of ['DELETE', 'PUT', 'PATCH', 'OPTIONS'] as const)
        expect(
          (await server.inject({ method, url: '/v1/projects' })).statusCode,
        ).toBe(405);
      expect(
        (await server.inject({ method: 'HEAD', url: '/v1/projects' }))
          .statusCode,
      ).toBe(200);
      expect(await store.listProjects({ ownerId: 'user' })).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('requires a verified bearer token before access to the configured identity', async () => {
    const token = 'test-token-'.repeat(4);
    const server = createHttpServer(undefined, {
      store: new InMemoryPlatformStore(),
      authorize: requireApiBearerToken(token),
    });
    try {
      expect((await server.inject('/v1/projects')).statusCode).toBe(401);
      expect(
        (
          await server.inject({
            url: '/v1/projects',
            headers: { authorization: 'Bearer wrong' },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await server.inject({
            url: '/v1/projects',
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(200);
      expect((await server.inject('/health')).statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('distinguishes idempotent replay, changed payload, and overlapping project work', async () => {
    const server = createHttpServer(undefined, {
      store: new InMemoryPlatformStore(),
    });
    try {
      const project = (
        await server.inject({
          method: 'POST',
          url: '/v1/projects',
          payload: { name: 'test' },
        })
      ).json();
      const request = {
        method: 'POST' as const,
        url: `/v1/projects/${project.id}/runs`,
        headers: { 'idempotency-key': 'key' },
        payload: { request_type: 'create', prompt: 'runner' },
      };
      const results = await Promise.all([
        server.inject(request),
        server.inject(request),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual([202, 202]);
      expect(results[0]?.json().id).toBe(results[1]?.json().id);
      expect(
        (
          await server.inject({
            ...request,
            payload: { request_type: 'create', prompt: 'different' },
          })
        ).json(),
      ).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(
        (
          await server.inject({
            ...request,
            headers: { 'idempotency-key': 'second' },
          })
        ).json(),
      ).toEqual({ code: 'PROJECT_RUN_ACTIVE' });
      expect(
        (
          await server.inject({
            ...request,
            payload: { request_type: 'validate', prompt: 'runner' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('validates upload types and accepts supported images larger than the old 1 MiB HTTP limit', async () => {
    const server = createHttpServer(undefined, {
      store: new InMemoryPlatformStore(),
    });
    try {
      const project = (
        await server.inject({
          method: 'POST',
          url: '/v1/projects',
          payload: {},
        })
      ).json();
      const url = `/v1/projects/${project.id}/assets`;
      expect(
        (
          await server.inject({
            method: 'POST',
            url,
            payload: {
              name: 123,
              mime_type: 'image/png',
              bytes_base64: 'abcd',
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await server.inject({
            method: 'POST',
            url,
            payload: {
              name: 'x',
              mime_type: 'image/png',
              bytes_base64: '%%%!',
            },
          })
        ).json(),
      ).toEqual({ code: 'ASSET_BASE64_INVALID' });
      const bytes = Buffer.alloc(1024 * 1024);
      bytes.set([137, 80, 78, 71]);
      expect(
        (
          await server.inject({
            method: 'POST',
            url,
            payload: {
              name: 'image.png',
              mime_type: 'image/png',
              bytes_base64: bytes.toString('base64'),
              license_text: 'test authorization',
            },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (await server.inject('/v1/projects/missing/versions')).statusCode,
      ).toBe(404);
    } finally {
      await server.close();
    }
  });
});
