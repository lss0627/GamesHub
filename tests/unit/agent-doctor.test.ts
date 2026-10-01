import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateAgentHealth,
  probeAgentRuntime,
} from '../../scripts/agent-doctor-lib';

function healthy() {
  return {
    status: 'ready',
    service: 'platform-api',
    framework: 'fastapi',
    domainTransport: 'stdio',
    creationReady: true,
    executionMode: 'real-unity',
    dataPlane: {
      postgres: { status: 'ready' },
      redis: { status: 'ready' },
      objectStorage: { status: 'ready' },
      durableFallback: 'postgresql-skip-locked',
    },
    services: {
      agent: { status: 'ready' },
      model: { status: 'ready' },
      unity: { status: 'ready' },
      images: { status: 'bypassed', configurationOnly: true },
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('agent runtime readiness', () => {
  it('accepts a complete core loop without optional AI image generation', () => {
    expect(evaluateAgentHealth(healthy())).toMatchObject({
      status: 'ready',
      nonBillable: true,
      blockingChecks: [],
      checks: { images: { status: 'bypassed', required: false } },
    });
    const value = healthy();
    value.services.images.status = 'blocked';
    expect(evaluateAgentHealth(value).status).toBe('ready');
    expect(evaluateAgentHealth(value, true).blockingChecks).toEqual(['images']);
  });

  it('requires explicit image configuration metadata, without claiming connectivity', () => {
    const value = healthy();
    value.services.images.status = 'ready';
    expect(evaluateAgentHealth(value, true)).toMatchObject({
      status: 'ready',
      checks: { images: { reason: 'IMAGE_CONFIGURATION_READY_NOT_PROBED' } },
    });
    value.services.images.configurationOnly = false;
    expect(evaluateAgentHealth(value, true).status).toBe('blocked');
  });

  it.each(['agent', 'model', 'unity'] as const)(
    'fails closed for absent or degraded %s',
    (name) => {
      const value = healthy();
      value.services[name].status = 'degraded';
      expect(evaluateAgentHealth(value).blockingChecks).toContain(name);
      Reflect.deleteProperty(value.services, name);
      expect(evaluateAgentHealth(value).checks[name]).toMatchObject({
        status: 'blocked',
        reason: 'DEPENDENCY_MISSING',
      });
    },
  );

  it.each(['postgres', 'objectStorage'] as const)(
    'requires durable %s',
    (name) => {
      const value = healthy();
      value.dataPlane[name].status = 'blocked';
      expect(evaluateAgentHealth(value).blockingChecks).toContain(name);
      Reflect.deleteProperty(value.dataPlane, name);
      expect(evaluateAgentHealth(value).blockingChecks).toContain(name);
    },
  );

  it('permits unavailable Redis only with a known durable PostgreSQL fallback', () => {
    const value = healthy();
    value.dataPlane.redis.status = 'blocked';
    expect(evaluateAgentHealth(value)).toMatchObject({
      status: 'ready',
      checks: { redis: { status: 'degraded', required: false } },
    });
    value.dataPlane.durableFallback = 'none';
    expect(evaluateAgentHealth(value).blockingChecks).toContain('redis');
  });

  it('does not treat fixture mode or denied creation admission as a complete loop', () => {
    const value = healthy();
    value.creationReady = false;
    value.executionMode = 'fixture';
    expect(evaluateAgentHealth(value).blockingChecks).toEqual([
      'admission',
      'execution',
    ]);
  });

  it.each([
    null,
    [],
    {},
    { status: 'ready' },
    { ...healthy(), status: 'unknown' },
    { ...healthy(), status: ['ready'] },
  ])('rejects malformed health data', (value) => {
    expect(evaluateAgentHealth(value)).toMatchObject({
      status: 'blocked',
      checks: { health: { reason: 'HEALTH_RESPONSE_INVALID' } },
    });
  });

  it('rejects a legacy server and never copies raw error details or credential-like metadata', () => {
    const value = { ...healthy(), framework: 'express' };
    expect(evaluateAgentHealth(value).status).toBe('blocked');
    const report = JSON.stringify(
      evaluateAgentHealth({
        ...healthy(),
        endpoint: 'http://admin:secret@example.test',
        services: {
          ...healthy().services,
          model: {
            status: 'blocked',
            provider: 'secret-key',
            detail: 'secret-key',
            model: 'secret-key',
          },
        },
      }),
    );
    expect(report).not.toContain('secret');
    expect(report).not.toContain('example.test');
  });
});

describe('agent doctor non-billable HTTP probe', () => {
  it('only GETs health and disables redirects when supplying optional authentication', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(healthy()));
    const result = await probeAgentRuntime({
      endpoint: 'http://localhost:3001/',
      bearerToken: 'private-token',
      fetchImpl,
    });
    expect(result.status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3001/health',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer private-token',
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it.each([401, 403, 404, 500])(
    'sanitizes HTTP %s failures',
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('raw-private-error', { status }));
      const result = await probeAgentRuntime({
        endpoint: 'http://localhost:3001',
        fetchImpl,
      });
      expect(result.status).toBe('blocked');
      expect(result.checks.health?.reason).toBe(
        status === 401 || status === 403
          ? 'HEALTH_AUTH_REQUIRED'
          : 'HEALTH_HTTP_ERROR',
      );
      expect(JSON.stringify(result)).not.toContain('raw-private-error');
    },
  );

  it('preserves useful mandatory dependency failures from a 503 health response', async () => {
    const value = healthy();
    value.services.unity.status = 'blocked';
    value.status = 'blocked';
    value.creationReady = false;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value, { status: 503 }));
    const result = await probeAgentRuntime({
      endpoint: 'http://localhost:3001',
      fetchImpl,
    });
    expect(result.blockingChecks).toEqual(['admission', 'unity', 'health']);
  });

  it('rejects invalid JSON and hides transport error messages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<html>private error</html>'))
      .mockRejectedValueOnce(
        new Error('URL http://private:secret@host failed'),
      );
    const options = { endpoint: 'http://localhost:3001', fetchImpl };
    expect((await probeAgentRuntime(options)).checks.health?.reason).toBe(
      'HEALTH_RESPONSE_INVALID',
    );
    const result = await probeAgentRuntime(options);
    expect(result.checks.health?.reason).toBe('HEALTH_UNREACHABLE');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    'http://user:secret@host',
    'http://host?key=secret',
    'file:///secret',
    'not a URL',
  ])('rejects unsafe endpoint %s before making a request', async (endpoint) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await probeAgentRuntime({ endpoint, fetchImpl });
    expect(result.checks.health?.reason).toBe('HEALTH_ENDPOINT_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(endpoint);
  });

  it.each(['connection', 'response-body'])(
    'bounds the %s deadline even when the transport does not settle',
    async (phase) => {
      vi.useFakeTimers();
      const pending = new Promise<never>(() => undefined);
      const fetchImpl = vi.fn<typeof fetch>();
      if (phase === 'connection') fetchImpl.mockReturnValue(pending);
      else {
        const response = Response.json({});
        vi.spyOn(response, 'json').mockReturnValue(pending);
        fetchImpl.mockResolvedValue(response);
      }
      const result = probeAgentRuntime({
        endpoint: 'http://localhost:3001',
        timeoutMs: 50,
        fetchImpl,
      });
      await vi.advanceTimersByTimeAsync(51);
      expect((await result).checks.health?.reason).toBe('HEALTH_TIMEOUT');
      const signal = fetchImpl.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
