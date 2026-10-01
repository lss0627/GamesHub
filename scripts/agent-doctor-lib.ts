export type DoctorStatus = 'ready' | 'degraded' | 'blocked' | 'bypassed';

export interface DoctorCheck {
  status: DoctorStatus;
  required: boolean;
  reason: string;
}

export interface AgentDoctorReport {
  status: 'ready' | 'blocked';
  scope: 'runtime-readiness';
  nonBillable: true;
  imageRequired: boolean;
  checks: Record<string, DoctorCheck>;
  blockingChecks: string[];
  limitations: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function report(
  checks: Record<string, DoctorCheck>,
  imageRequired: boolean,
): AgentDoctorReport {
  const blockingChecks = Object.entries(checks)
    .filter(([, check]) => check.required && check.status !== 'ready')
    .map(([name]) => name);
  return {
    status: blockingChecks.length ? 'blocked' : 'ready',
    scope: 'runtime-readiness',
    nonBillable: true,
    imageRequired,
    checks,
    blockingChecks,
    limitations: [
      'Model and image readiness checks configuration, not provider connectivity or balance.',
      'Unity license is checked during a real build.',
      'No generation, Unity build, browser playtest, or complete creation cycle was executed.',
    ],
  };
}

function failure(reason: string, requireImage: boolean): AgentDoctorReport {
  return report(
    { health: { status: 'blocked', required: true, reason } },
    requireImage,
  );
}

export function evaluateAgentHealth(
  value: unknown,
  requireImage = false,
): AgentDoctorReport {
  const health = record(value);
  if (
    typeof health.status !== 'string' ||
    !['ready', 'degraded', 'blocked'].includes(health.status) ||
    typeof health.creationReady !== 'boolean'
  )
    return failure('HEALTH_RESPONSE_INVALID', requireImage);
  if (
    health.service !== 'platform-api' ||
    health.framework !== 'fastapi' ||
    health.domainTransport !== 'stdio'
  )
    return failure('AGENT_RUNTIME_IDENTITY_REQUIRED', requireImage);

  const services = record(health.services);
  const plane = record(health.dataPlane);
  const checks: Record<string, DoctorCheck> = {
    admission: {
      status:
        health.creationReady && health.status !== 'blocked'
          ? 'ready'
          : 'blocked',
      required: true,
      reason:
        health.creationReady && health.status !== 'blocked'
          ? 'CREATION_ADMISSION_READY'
          : 'CREATION_ADMISSION_BLOCKED',
    },
    execution: {
      status: health.executionMode === 'real-unity' ? 'ready' : 'blocked',
      required: true,
      reason:
        health.executionMode === 'real-unity'
          ? 'REAL_UNITY_CONFIGURED'
          : 'REAL_UNITY_REQUIRED',
    },
  };
  for (const [name, value] of [
    ['agent', services.agent],
    ['model', services.model],
    ['unity', services.unity],
    ['postgres', plane.postgres],
    ['objectStorage', plane.objectStorage],
  ] as const) {
    const dependency = record(value);
    checks[name] = {
      status: dependency.status === 'ready' ? 'ready' : 'blocked',
      required: true,
      reason:
        dependency.status === 'ready'
          ? 'DEPENDENCY_READY'
          : dependency.status === undefined
            ? 'DEPENDENCY_MISSING'
            : 'DEPENDENCY_NOT_READY',
    };
  }
  const redis = record(plane.redis);
  const durableFallback = plane.durableFallback === 'postgresql-skip-locked';
  checks.redis = {
    status:
      redis.status === 'ready'
        ? 'ready'
        : durableFallback
          ? 'degraded'
          : 'blocked',
    required: !durableFallback,
    reason:
      redis.status === 'ready'
        ? 'WAKEUP_READY'
        : durableFallback
          ? 'POSTGRES_DURABLE_POLLING_AVAILABLE'
          : 'WAKEUP_AND_DURABLE_FALLBACK_UNAVAILABLE',
  };
  const images = record(services.images);
  const imageReady =
    images.status === 'ready' && images.configurationOnly === true;
  checks.images = {
    status: imageReady
      ? 'ready'
      : images.status === 'bypassed'
        ? 'bypassed'
        : 'blocked',
    required: requireImage,
    reason: imageReady
      ? 'IMAGE_CONFIGURATION_READY_NOT_PROBED'
      : images.status === undefined
        ? 'IMAGE_READINESS_UNAVAILABLE'
        : 'IMAGE_CONFIGURATION_UNAVAILABLE',
  };
  return report(checks, requireImage);
}

export async function probeAgentRuntime(options: {
  endpoint: string;
  bearerToken?: string;
  requireImage?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AgentDoctorReport> {
  const requireImage = options.requireImage ?? false;
  let url: URL;
  try {
    url = new URL(options.endpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return failure('HEALTH_ENDPOINT_INVALID', requireImage);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/health`;
  } catch {
    return failure('HEALTH_ENDPOINT_INVALID', requireImage);
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    return failure('HEALTH_TIMEOUT_INVALID', requireImage);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<AgentDoctorReport>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failure('HEALTH_TIMEOUT', requireImage));
    }, timeoutMs);
  });
  const probe = async (): Promise<AgentDoctorReport> => {
    try {
      const response = await (options.fetchImpl ?? fetch)(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.bearerToken
            ? { Authorization: `Bearer ${options.bearerToken}` }
            : {}),
        },
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403)
        return failure('HEALTH_AUTH_REQUIRED', requireImage);
      if (response.status !== 200 && response.status !== 503)
        return failure('HEALTH_HTTP_ERROR', requireImage);
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        return failure('HEALTH_RESPONSE_INVALID', requireImage);
      }
      const result = evaluateAgentHealth(value, requireImage);
      if (response.status === 503) {
        result.checks.health = {
          status: 'blocked',
          required: true,
          reason: 'HEALTH_HTTP_UNAVAILABLE',
        };
        return report(result.checks, requireImage);
      }
      return result;
    } catch {
      return failure(
        controller.signal.aborted ? 'HEALTH_TIMEOUT' : 'HEALTH_UNREACHABLE',
        requireImage,
      );
    }
  };
  try {
    return await Promise.race([probe(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
