import { timingSafeEqual } from 'node:crypto';
import {
  AssetRepository,
  HttpAssetScanner,
  HttpImageDecoder,
  PostgresAssetMetadataStore,
  S3ObjectStore,
} from '@gamerhub/assets';
import {
  loadEnvironment,
  requireProductionUnityLicenseDecision,
} from '@gamerhub/contracts';
import {
  InMemoryPlatformStore,
  type PlatformStore,
  PostgresDomainRepository,
} from '@gamerhub/domain';
import { probePostgres, RedisRunSignal } from '@gamerhub/runtime-infra';
import { RestoreService } from '@gamerhub/versioning';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { createPlatformApi, type PlatformApiOptions } from './app';
import { parseBearerToken } from './middleware/auth';
import type { VersionRestoreService } from './routes/versions';
import { DesignService } from './services/design-service';
import { DurableSpecVersionService } from './services/spec-version-service';

export { publicRun } from './app';

export function requireApiBearerToken(
  token: string | undefined,
): (header: string | undefined) => boolean {
  if (!token || token.length < 32)
    throw new Error('GAMERHUB_API_BEARER_TOKEN_REQUIRED');
  const expected = Buffer.from(token);
  return (header) => {
    try {
      const actual = Buffer.from(parseBearerToken(header));
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    } catch {
      return false;
    }
  };
}

export function health() {
  return { status: 'ready', service: 'platform-api' } as const;
}

export function createHttpServer(
  identity = { userId: 'local-user', role: 'creator' as const },
  options: {
    store?: PlatformStore;
    restoreService?: VersionRestoreService;
    assetRepository?: AssetRepository;
    onRunAccepted?: PlatformApiOptions['onRunAccepted'];
    health?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
    authorize?: (
      authorization: string | undefined,
    ) => boolean | Promise<boolean>;
  } = {},
): FastifyInstance {
  const server = Fastify({ logger: false });
  const authorize =
    options.authorize ??
    (process.env.NODE_ENV === 'production'
      ? requireApiBearerToken(process.env.GAMERHUB_API_BEARER_TOKEN)
      : undefined);
  server.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/health') return;
    if (authorize && !(await authorize(request.headers.authorization)))
      return reply.code(401).send({ code: 'AUTH_REQUIRED' });
    if (!['GET', 'POST', 'HEAD'].includes(request.method))
      return reply
        .code(405)
        .header('allow', 'GET, POST, HEAD')
        .send({ code: 'METHOD_NOT_ALLOWED' });
  });
  server.setErrorHandler<FastifyError>((error, _request, reply) => {
    const code = typeof error.code === 'string' ? error.code : error.message;
    if (code === 'NOT_FOUND' || /_NOT_FOUND$/.test(code))
      return reply.code(404).send({ code: 'NOT_FOUND' });
    if (
      [
        'PROJECT_RUN_ACTIVE',
        'IDEMPOTENCY_CONFLICT',
        'RUN_INVALID_TRANSITION',
      ].includes(code)
    )
      return reply.code(409).send({ code });
    if (
      [
        'SIZE_LIMIT',
        'MIME_MISMATCH',
        'DECODE_BOMB',
        'LICENSE_REQUIRED',
        'WORKSPACE_ESCAPE',
      ].includes(code)
    )
      return reply.code(400).send({ code });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply
        .code(error.statusCode)
        .send({ code: error.code ?? 'BAD_REQUEST' });
    if (code.startsWith('DESIGN_') && error.statusCode)
      return reply.code(error.statusCode).send({ code });
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  const store = options.store ?? configuredStore();
  const apiOptions: PlatformApiOptions = {
    store,
    ...(options.onRunAccepted ? { onRunAccepted: options.onRunAccepted } : {}),
  };
  const api = createPlatformApi(identity, apiOptions);
  const designs = new DesignService(store, identity.userId, api);
  server.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/design',
    (request) => designs.get(request.params.projectId),
  );
  server.get<{ Params: { projectId: string; assetId: string } }>(
    '/v1/projects/:projectId/assets/:assetId/content',
    async (request, reply) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      const { asset, bytes } = await assetRepository.readAsset(
        request.params.projectId,
        request.params.assetId,
      );
      return reply
        .header('content-type', asset.mediaType)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=300')
        .send(Buffer.from(bytes));
    },
  );
  server.post<{
    Params: { projectId: string };
    Body: {
      revision: number;
      message: string;
      creationMode?: 'quick' | 'discuss';
    };
  }>('/v1/projects/:projectId/design/messages', (request) =>
    designs.message(
      request.params.projectId,
      request.body?.revision,
      request.body?.message,
      request.body?.creationMode,
    ),
  );
  server.post<{ Params: { projectId: string }; Body: { revision: number } }>(
    '/v1/projects/:projectId/design/prepare',
    (request) =>
      designs.prepare(request.params.projectId, request.body?.revision),
  );
  server.post<{ Params: { projectId: string }; Body: { revision: number } }>(
    '/v1/projects/:projectId/design/confirm',
    (request) =>
      designs.confirm(request.params.projectId, request.body?.revision),
  );
  server.get('/health', async (_request, reply) => {
    const result = options.health ? await options.health() : health();
    const status = typeof result.status === 'string' ? result.status : 'ready';
    return reply
      .code(status === 'blocked' ? 503 : 200)
      .header('cache-control', 'no-store')
      .send(result);
  });
  const restoreService =
    options.restoreService ?? configuredRestoreService(identity.userId, store);
  server.get<{
    Params: { projectId: string; runId: string };
    Querystring: { after?: string };
  }>('/v1/projects/:projectId/runs/:runId/events', async (request, reply) => {
    const headerCursor = request.headers['last-event-id'];
    const after = Number(headerCursor ?? request.query.after ?? 0);
    const result = await api.request({
      method: 'GET',
      path: `/v1/projects/${encodeURIComponent(request.params.projectId)}/runs/${encodeURIComponent(request.params.runId)}/events?after=${Number.isFinite(after) ? Math.max(0, after) : 0}`,
    });
    if (result.status !== 200)
      return reply.code(result.status).send(result.body);
    if (result.headers)
      for (const [key, value] of Object.entries(result.headers))
        reply.header(key, value);
    reply
      .header('content-type', 'text/event-stream')
      .header('cache-control', 'no-cache')
      .header('connection', 'keep-alive');
    const body = result.body as { sse?: unknown };
    return reply.send(
      `: gamerhub-heartbeat\n\n${typeof body.sse === 'string' ? body.sse : ''}`,
    );
  });
  server.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/versions',
    async (request) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      return { items: await restoreService.list(request.params.projectId) };
    },
  );
  server.post<{ Params: { projectId: string; checkpointId: string } }>(
    '/v1/projects/:projectId/versions/:checkpointId/restore',
    async (request, reply) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !key.trim() || key.length > 200)
        return reply.code(400).send({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      return reply
        .code(202)
        .send(
          await restoreService.restore(
            request.params.projectId,
            request.params.checkpointId,
            key,
          ),
        );
    },
  );
  const assetRepository =
    options.assetRepository ??
    configuredAssetRepository(identity.userId, store);
  server.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/assets',
    async (request) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      return { items: await assetRepository.list(request.params.projectId) };
    },
  );
  server.post<{
    Params: { projectId: string };
    Body: {
      name?: string;
      mime_type?: string;
      bytes_base64?: string;
      license_text?: string;
      created_by_run_id?: string;
    };
  }>(
    '/v1/projects/:projectId/assets',
    { bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      const body = request.body ?? {};
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 255 ||
        typeof body.mime_type !== 'string' ||
        typeof body.bytes_base64 !== 'string' ||
        !body.bytes_base64 ||
        (body.license_text !== undefined &&
          typeof body.license_text !== 'string') ||
        (body.created_by_run_id !== undefined &&
          typeof body.created_by_run_id !== 'string')
      )
        return reply.code(400).send({ code: 'ASSET_UPLOAD_FIELDS_REQUIRED' });
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          body.bytes_base64,
        )
      )
        return reply.code(400).send({ code: 'ASSET_BASE64_INVALID' });
      if (body.created_by_run_id)
        await store.getRun(request.params.projectId, body.created_by_run_id, {
          ownerId: identity.userId,
        });
      const bytes = Buffer.from(body.bytes_base64, 'base64');
      const assetInput = {
        projectId: request.params.projectId,
        createdByRunId: body.created_by_run_id ?? 'api-upload',
        name: body.name,
        mimeType: body.mime_type,
        bytes,
        ...(body.license_text ? { licenseText: body.license_text } : {}),
      };
      const asset = await assetRepository.upload(assetInput);
      return reply.code(201).send(asset);
    },
  );
  server.post<{
    Params: { projectId: string; assetId: string };
  }>(
    '/v1/projects/:projectId/assets/:assetId/replace',
    async (request, reply) => {
      await store.getProject(request.params.projectId, {
        ownerId: identity.userId,
      });
      const asset = (await assetRepository.list(request.params.projectId)).find(
        (item) => item.id === request.params.assetId,
      );
      if (!asset) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
      const idempotencyKey =
        request.headers['idempotency-key'] ??
        request.headers['Idempotency-Key'];
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())
        return reply.code(400).send({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      const result = await api.request({
        method: 'POST',
        path: `/v1/projects/${encodeURIComponent(request.params.projectId)}/runs`,
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          request_type: 'modify',
          prompt: `替换角色为素材 ${asset.id}`,
        },
      });
      return reply.code(result.status).send(result.body);
    },
  );
  server.all('/v1/*', async (request, reply) => {
    const result = await api.request({
      method: request.method === 'POST' ? 'POST' : 'GET',
      path: request.url,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] : value,
        ]),
      ),
      body: request.body,
    });
    if (result.headers)
      for (const [key, value] of Object.entries(result.headers))
        reply.header(key, value);
    return reply.code(result.status).send(result.body);
  });
  return server;
}

function configuredStore(): PlatformStore {
  if (process.env.DATABASE_URL)
    return PostgresDomainRepository.fromEnvironment();
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL_REQUIRED');
  return new InMemoryPlatformStore();
}

function configuredRestoreService(
  ownerId: string,
  store: PlatformStore,
): VersionRestoreService {
  if (process.env.NODE_ENV !== 'production') return new RestoreService();
  if (!(store instanceof PostgresDomainRepository))
    throw new Error('DURABLE_RESTORE_REQUIRES_POSTGRES');
  return new DurableSpecVersionService(store, ownerId);
}

function configuredAssetRepository(
  ownerId: string,
  store: PlatformStore,
): AssetRepository {
  if (process.env.NODE_ENV !== 'production')
    return new AssetRepository({ ownerId });
  if (!(store instanceof PostgresDomainRepository))
    throw new Error('DURABLE_ASSET_STORE_REQUIRES_POSTGRES');
  const required = {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    region: process.env.OBJECT_STORAGE_REGION,
    bucket: process.env.OBJECT_STORAGE_BUCKET,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    scannerEndpoint: process.env.ASSET_SCANNER_ENDPOINT,
    decoderEndpoint: process.env.ASSET_DECODER_ENDPOINT,
  };
  if (Object.values(required).some((value) => !value?.trim()))
    throw new Error('DURABLE_ASSET_PIPELINE_CONFIG_REQUIRED');
  const requiredValue = (value: string | undefined): string => {
    if (!value?.trim())
      throw new Error('DURABLE_ASSET_PIPELINE_CONFIG_REQUIRED');
    return value;
  };
  const endpoint = requiredValue(required.endpoint);
  const region = requiredValue(required.region);
  const bucket = requiredValue(required.bucket);
  const accessKeyId = requiredValue(required.accessKeyId);
  const secretAccessKey = requiredValue(required.secretAccessKey);
  const scannerEndpoint = requiredValue(required.scannerEndpoint);
  const decoderEndpoint = requiredValue(required.decoderEndpoint);
  const objectStore = new S3ObjectStore({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  });
  return new AssetRepository({
    ownerId,
    objectStore,
    metadataStore: new PostgresAssetMetadataStore(
      store.pool,
      store.withTenantTransaction.bind(store),
    ),
    scanner: new HttpAssetScanner({
      endpoint: scannerEndpoint,
      ...(process.env.ASSET_SCANNER_API_KEY
        ? { apiKey: process.env.ASSET_SCANNER_API_KEY }
        : {}),
    }),
    decoder: new HttpImageDecoder({
      endpoint: decoderEndpoint,
      ...(process.env.ASSET_DECODER_API_KEY
        ? { apiKey: process.env.ASSET_DECODER_API_KEY }
        : {}),
    }),
  });
}

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.GAMERHUB_START_SERVER === '1'
) {
  loadEnvironment(process.env);
  if (process.env.NODE_ENV === 'production')
    requireProductionUnityLicenseDecision();
  const port = Number(process.env.API_PORT ?? 3001);
  const store = configuredStore();
  const runSignal = process.env.REDIS_URL
    ? await RedisRunSignal.connect(process.env.REDIS_URL)
    : undefined;
  const identity = {
    userId:
      process.env.GAMERHUB_API_USER_ID ??
      (process.env.NODE_ENV === 'production'
        ? (() => {
            throw new Error('GAMERHUB_API_USER_ID_REQUIRED');
          })()
        : 'local-user'),
    role: 'creator' as const,
  };
  const server = createHttpServer(identity, {
    store,
    ...(runSignal
      ? {
          onRunAccepted: async (run) => {
            return {
              transport: 'redis-pubsub',
              delivered: await runSignal.notify(run.id, run.traceId),
            };
          },
        }
      : {}),
    health: async () => {
      const postgres =
        store instanceof PostgresDomainRepository
          ? await probePostgres(store.pool)
          : {
              status: 'bypassed' as const,
              latencyMs: 0,
              detail: 'in-memory-development',
            };
      const redis = runSignal
        ? await runSignal.probe()
        : {
            status: 'bypassed' as const,
            latencyMs: 0,
            detail: 'postgresql-polling-only',
          };
      return {
        status: postgres.status === 'degraded' ? 'blocked' : 'ready',
        service: 'platform-api',
        dataPlane: {
          authoritativeStore:
            store instanceof PostgresDomainRepository
              ? 'postgresql'
              : 'process-memory',
          wakeupTransport: runSignal ? 'redis-pubsub' : 'polling',
          durableFallback: 'postgresql-skip-locked',
          postgres,
          redis,
        },
      };
    },
  });
  await server.listen({ host: process.env.HOST ?? '127.0.0.1', port });
  console.log(JSON.stringify({ ...health(), port }));
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([
      server.close(),
      runSignal?.close(),
      store instanceof PostgresDomainRepository ? store.close() : undefined,
    ]);
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}
