import { InMemoryPlatformStore } from '@gamerhub/domain';
import { describe, expect, it } from 'vitest';
import { createHttpServer } from '../../apps/platform-api/src/server';

describe('platform health contract', () => {
  it('returns no-store dependency metadata for a ready data plane', async () => {
    const server = createHttpServer(
      { userId: 'local-user', role: 'creator' },
      {
        store: new InMemoryPlatformStore(),
        health: async () => ({
          status: 'ready',
          service: 'platform-api',
          dataPlane: {
            authoritativeStore: 'postgresql',
            postgres: { status: 'ready' },
            redis: { status: 'ready' },
          },
        }),
      },
    );

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      status: 'ready',
      dataPlane: {
        authoritativeStore: 'postgresql',
        postgres: { status: 'ready' },
        redis: { status: 'ready' },
      },
    });
    await server.close();
  });

  it('uses HTTP 503 only for a blocked critical dependency', async () => {
    const server = createHttpServer(
      { userId: 'local-user', role: 'creator' },
      {
        store: new InMemoryPlatformStore(),
        health: () => ({ status: 'blocked', service: 'platform-api' }),
      },
    );

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'blocked',
      service: 'platform-api',
    });
    await server.close();
  });
});
