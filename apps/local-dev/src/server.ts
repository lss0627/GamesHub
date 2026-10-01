import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { InMemoryPlatformStore } from '@gamerhub/domain';
import type { PlannerTask } from '@gamerhub/game-planner';
import { GameSpecService } from '@gamerhub/game-spec';
import {
  createConfiguredPromptInterpreter,
  OrchestratorWorker,
  runWorkerLoop,
  type WorkerTaskExecutor,
} from '@gamerhub/orchestrator-worker';
import { createHttpServer } from '@gamerhub/platform-api';
import { InMemoryCheckpointService } from '@gamerhub/versioning';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createPostgresRedisDataPlane,
  type PostgresRedisDataPlane,
} from './data-plane';
import { loadLocalEnvironment } from './environment';
import {
  LocalJsonGameSpecPersistence,
  LocalJsonPlatformStore,
} from './local-persistence';
import { LocalGameSpecVersionService } from './local-version-service';
import {
  RealUnityLocalManager,
  registerRealUnityPreviewRoutes,
} from './real-unity';
import { SourceCheckpointService } from './source-checkpoints';

loadLocalEnvironment();

const localHost = '127.0.0.1';

function fixtureHash(value: string): string {
  return `sha256-${createHash('sha256').update(value).digest('hex')}`;
}

function evidenceTypes(task: PlannerTask): string[] {
  const types = new Set<string>();
  if (task.type === 'spec' || task.validation_method.type === 'schema')
    types.add('schema');
  if (['scene', 'component', 'script', 'asset'].includes(task.type))
    types.add('engine');
  if (
    task.type === 'test' ||
    ['editmode_test', 'playmode_test'].includes(task.validation_method.type)
  )
    types.add('test');
  if (task.type === 'playtest') types.add('playtest');
  if (task.type === 'evaluate') types.add('evaluation');
  if (task.type === 'build' || task.type === 'publish') types.add('build');
  if (types.size === 0) types.add('engine');
  return [...types];
}

export function createLocalTaskExecutor(): WorkerTaskExecutor {
  return {
    async execute(task, runId) {
      const contentHash = fixtureHash(`${runId}:${task.id}`);
      return {
        taskId: task.id,
        status: 'completed',
        evidence: evidenceTypes(task).map((type) => ({
          type,
          reference: `fixture://local-dev/${encodeURIComponent(runId)}/${encodeURIComponent(task.id)}/${type}`,
          contentHash,
        })),
        changedArtifacts: task.related_files,
        projectRevision: `fixture-local-${contentHash.slice(-12)}`,
      };
    },
  };
}

function decodeBytes(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.length > 0 && bytes.length <= 25 * 1024 * 1024
      ? bytes
      : undefined;
  } catch {
    return undefined;
  }
}

function pngDimensions(
  bytes: Buffer,
): { width: number; height: number } | undefined {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  )
    return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function jpegDimensions(
  bytes: Buffer,
): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) return undefined;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length + 2;
  }
  return undefined;
}

function webpDimensions(
  bytes: Buffer,
): { width: number; height: number } | undefined {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  )
    return undefined;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { width, height };
  }
  return { width: 1, height: 1 };
}

function imageDimensions(
  bytes: Buffer,
  mimeType: unknown,
): { width: number; height: number } | undefined {
  if (mimeType === 'image/png') return pngDimensions(bytes);
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  if (mimeType === 'image/webp') return webpDimensions(bytes);
  return undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

function previewHtml(projectId: string, buildHash: string): string {
  const project = escapeHtml(projectId);
  const build = escapeHtml(buildHash);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>GamerHub 本地开发预览</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #101828; color: #fff; }
    main { width: min(920px, 94vw); }
    .notice { padding: 10px 14px; margin-bottom: 10px; border: 1px solid #fdb022; border-radius: 10px; background: #3b2f12; }
    canvas { width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; background: linear-gradient(#77c8ff 0 70%, #477d36 70%); }
    small { display: block; margin-top: 8px; color: #cbd5e1; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <div class="notice"><strong>本地开发 Fixture</strong>：用于验证 Studio/API/Worker 交互，不是 Unity 构建或发布证据。</div>
    <canvas id="game" width="960" height="540" aria-label="本地跑酷开发预览"></canvas>
    <small>空格/↑ 跳跃，R 重开 · project=${project} · build=${build}</small>
  </main>
  <script>
    const canvas = document.querySelector('#game');
    const context = canvas.getContext('2d');
    const player = { x: 120, y: 390, vy: 0 };
    let score = 0;
    let frame = 0;
    const reset = () => { player.y = 390; player.vy = 0; score = 0; frame = 0; };
    addEventListener('keydown', (event) => {
      if ((event.code === 'Space' || event.code === 'ArrowUp') && player.y >= 390) player.vy = -15;
      if (event.code === 'KeyR') reset();
    });
    function render() {
      frame += 1;
      player.vy += 0.8;
      player.y = Math.min(390, player.y + player.vy);
      if (player.y >= 390) player.vy = 0;
      if (frame % 90 === 0) score += 1;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#f79009'; context.fillRect(player.x, player.y, 54, 64);
      context.fillStyle = '#fff'; context.font = '700 28px system-ui'; context.fillText('GamerHub Runner · ' + score, 28, 48);
      context.fillStyle = '#fde272'; context.beginPath(); context.arc(650 - (frame * 4 % 760), 360, 18, 0, Math.PI * 2); context.fill();
      requestAnimationFrame(render);
    }
    render();
  </script>
</body>
</html>`;
}

export function createLocalSupportServer(
  publicOrigin = `http://${localHost}:3010`,
  options: {
    executionMode?: LocalExecutionMode;
    realUnityManager?: RealUnityLocalManager;
  } = {},
): FastifyInstance {
  const server = Fastify({ logger: false });
  server.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith('/real-previews/')) {
      const provenance =
        request.url === '/health' && options.executionMode === 'real-unity'
          ? 'real-unity-local-dev'
          : 'fixture-local-dev';
      reply.header('x-gamerhub-provenance', provenance);
    }
    return payload;
  });
  server.get('/health', async () => ({
    status: 'ready',
    service: 'gamerhub-local-support',
    provenance:
      options.executionMode === 'real-unity'
        ? 'real-unity-local-dev'
        : 'fixture-local-dev',
    fixtureSupportProtocols: true,
  }));
  server.post<{ Body: { bytes_base64?: string } }>(
    '/scan',
    async (request, reply) => {
      const bytes = decodeBytes(request.body?.bytes_base64);
      if (!bytes)
        return reply.code(400).send({ code: 'LOCAL_SCAN_INPUT_INVALID' });
      const text = bytes.toString('latin1');
      const executable =
        bytes.subarray(0, 2).toString('ascii') === 'MZ' ||
        bytes.subarray(0, 4).toString('hex') === '7f454c46' ||
        text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
      return {
        clean: !executable,
        report_reference: `fixture://local-dev/scanner/${fixtureHash(bytes.toString('base64'))}`,
        limitations: 'signature-smoke-only-not-a-production-malware-scan',
      };
    },
  );
  server.post<{
    Body: { bytes_base64?: string; mime_type?: string };
  }>('/decode', async (request, reply) => {
    const bytes = decodeBytes(request.body?.bytes_base64);
    const dimensions = bytes
      ? imageDimensions(bytes, request.body?.mime_type)
      : undefined;
    if (!bytes || !dimensions)
      return reply.code(400).send({ code: 'LOCAL_IMAGE_INVALID' });
    return {
      bytes_base64: bytes.toString('base64'),
      mime_type: request.body.mime_type,
      ...dimensions,
      provenance: 'fixture-passthrough-not-production-reencode',
    };
  });
  server.post('/handshake', async () => ({
    session_id: randomUUID(),
    capabilities: [
      'input.action',
      'state.entity',
      'time.advance',
      'frame.capture',
    ],
    provenance: 'fixture-local-dev',
  }));
  server.post<{
    Body: {
      request_id?: string;
      sequence?: number;
      command?: string;
      arguments?: Record<string, unknown>;
    };
  }>('/commands', async (request, reply) => {
    const { request_id: requestId, sequence, command } = request.body ?? {};
    if (!requestId || typeof sequence !== 'number' || !command)
      return reply.code(400).send({ code: 'LOCAL_PROBE_COMMAND_INVALID' });
    return {
      request_id: requestId,
      sequence,
      status: 'ok',
      simulation_tick: sequence * 10,
      result: { command, fixture: true },
      evidence_ids: [`fixture-local-probe-${sequence}`],
    };
  });
  server.delete('/sessions/:sessionId', async () => ({ closed: true }));
  server.post<{
    Body: { run_id?: string; task_id?: string; evidence?: unknown[] };
  }>('/evaluate', async (request) => ({
    passed: true,
    report_key: `fixture://local-dev/evaluation/${request.body?.run_id ?? 'unknown'}`,
    evaluator_version: 'local-fixture-1.0.0',
    evidence: [
      {
        type: 'evaluation',
        reference: `fixture://local-dev/evaluator/${request.body?.task_id ?? 'unknown'}`,
      },
    ],
  }));
  server.post<{
    Body: { project_id?: string; build_hash?: string };
  }>('/publish', async (request, reply) => {
    const projectId = request.body?.project_id;
    const buildHash = request.body?.build_hash;
    if (!projectId || !buildHash)
      return reply.code(400).send({ code: 'LOCAL_PREVIEW_INPUT_INVALID' });
    const url = `${publicOrigin}/previews/${encodeURIComponent(projectId)}/${encodeURIComponent(buildHash)}/index.html`;
    return {
      healthy: true,
      url,
      build_hash: buildHash,
      evidence: [
        {
          type: 'preview',
          reference: `fixture://local-dev/preview/${buildHash}`,
        },
      ],
    };
  });
  server.get<{
    Params: { projectId: string; buildHash: string };
  }>('/previews/:projectId/:buildHash/index.html', async (request, reply) =>
    reply
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      )
      .type('text/html; charset=utf-8')
      .send(previewHtml(request.params.projectId, request.params.buildHash)),
  );
  if (options.realUnityManager)
    registerRealUnityPreviewRoutes(server, options.realUnityManager);
  return server;
}

export type LocalExecutionMode = 'fixture' | 'real-unity';
export type LocalDataMode = 'memory' | 'json' | 'postgres-redis';

export function localExecutionMode(
  value = process.env.GAMERHUB_LOCAL_EXECUTION_MODE,
): LocalExecutionMode {
  if (!value || value === 'fixture') return 'fixture';
  if (value === 'real-unity') return value;
  throw new Error('LOCAL_EXECUTION_MODE_INVALID');
}

export function localDataMode(
  value = process.env.GAMERHUB_LOCAL_DATA_MODE,
  executionMode: LocalExecutionMode = localExecutionMode(),
): LocalDataMode {
  if (!value) return executionMode === 'real-unity' ? 'json' : 'memory';
  if (['memory', 'json', 'postgres-redis'].includes(value))
    return value as LocalDataMode;
  throw new Error('LOCAL_DATA_MODE_INVALID');
}

export interface LocalDevelopmentRuntime {
  api: FastifyInstance;
  support: FastifyInstance;
  close(): Promise<void>;
}

export async function startLocalDevelopmentRuntime(
  options: {
    host?: string;
    apiPort?: number;
    supportPort?: number;
    executionMode?: LocalExecutionMode;
    dataMode?: LocalDataMode;
  } = {},
): Promise<LocalDevelopmentRuntime> {
  const host = options.host ?? process.env.HOST ?? localHost;
  const apiPort = options.apiPort ?? Number(process.env.API_PORT ?? 3001);
  const supportPort =
    options.supportPort ?? Number(process.env.LOCAL_SUPPORT_PORT ?? 3010);
  const supportOrigin = `http://${host}:${supportPort}`;
  const executionMode = options.executionMode ?? localExecutionMode();
  const dataMode = options.dataMode ?? localDataMode(undefined, executionMode);
  const ownerId =
    dataMode === 'postgres-redis'
      ? (process.env.GAMERHUB_LOCAL_USER_ID ??
        '00000000-0000-4000-8000-000000000001')
      : 'local-user';
  const platformSnapshotPath =
    process.env.GAMERHUB_LOCAL_PLATFORM_SNAPSHOT ??
    fileURLToPath(
      new URL('../../../artifacts/local-dev/platform.json', import.meta.url),
    );
  const gameSpecSnapshotPath =
    process.env.GAMERHUB_LOCAL_GAME_SPEC_SNAPSHOT ??
    fileURLToPath(
      new URL('../../../artifacts/local-dev/game-specs.json', import.meta.url),
    );
  let durableDataPlane: PostgresRedisDataPlane | undefined;
  if (dataMode === 'postgres-redis')
    durableDataPlane = await createPostgresRedisDataPlane(
      supportOrigin,
      ownerId,
    );
  const store =
    durableDataPlane?.store ??
    (dataMode === 'json'
      ? await LocalJsonPlatformStore.open(platformSnapshotPath)
      : new InMemoryPlatformStore());
  const specService =
    durableDataPlane?.specService ??
    (dataMode === 'json'
      ? new GameSpecService(
          await LocalJsonGameSpecPersistence.open(gameSpecSnapshotPath),
        )
      : undefined);
  const promptInterpreter = createConfiguredPromptInterpreter(process.env, {
    allowFixture: executionMode === 'fixture',
    allowMissingDeepSeekKeyFallback: executionMode === 'fixture',
  });
  const realUnityManager =
    executionMode === 'real-unity'
      ? new RealUnityLocalManager({
          editorPath: process.env.UNITY_EDITOR_PATH ?? '',
          templatePath: process.env.UNITY_GOLDEN_PROJECT ?? '',
          workspaceRoot:
            process.env.GAMERHUB_LOCAL_UNITY_WORKSPACE_ROOT ??
            fileURLToPath(
              new URL('../../../unity/LocalProjects/', import.meta.url),
            ),
          publicOrigin: supportOrigin,
          ...(durableDataPlane ? { durableStore: durableDataPlane.store } : {}),
        })
      : undefined;
  const support = createLocalSupportServer(supportOrigin, {
    executionMode,
    ...(realUnityManager ? { realUnityManager } : {}),
  });
  const api = createHttpServer(
    { userId: ownerId, role: 'creator' },
    {
      store,
      ...(durableDataPlane
        ? {
            assetRepository: durableDataPlane.assetRepository,
            onRunAccepted: async (run: { id: string }) => {
              return {
                transport: 'redis-pubsub',
                delivered:
                  (await durableDataPlane?.runSignal.notify(
                    run.id,
                    'traceId' in run && typeof run.traceId === 'string'
                      ? run.traceId
                      : undefined,
                  )) ?? false,
              };
            },
          }
        : {}),
      ...(specService
        ? {
            restoreService: new LocalGameSpecVersionService(
              store,
              specService,
              ownerId,
            ),
          }
        : {}),
      health: async () => {
        const dataPlane = durableDataPlane
          ? await durableDataPlane.health()
          : {
              mode: dataMode,
              authoritativeStore:
                dataMode === 'json' ? 'local-json' : 'process-memory',
              wakeupTransport: 'polling',
              durableFallback: 'none',
              postgres: {
                status: 'bypassed',
                latencyMs: 0,
                detail: 'not-selected',
              },
              redis: {
                status: 'bypassed',
                latencyMs: 0,
                detail: 'not-selected',
              },
              objectStorage: {
                status: 'bypassed',
                latencyMs: 0,
                detail: 'not-selected',
              },
            };
        const criticalReady =
          dataPlane.postgres.status !== 'degraded' &&
          dataPlane.objectStorage.status !== 'degraded';
        return {
          status: criticalReady
            ? dataPlane.redis.status === 'degraded'
              ? 'degraded'
              : 'ready'
            : 'blocked',
          service: 'platform-api',
          provenance:
            executionMode === 'real-unity'
              ? 'real-unity-local-dev'
              : 'fixture-local-dev',
          executionMode,
          dataPlane,
          services: {
            model: {
              status: promptInterpreter.configuration.awaitingSecret
                ? 'degraded'
                : 'ready',
              provider: promptInterpreter.configuration.requestedProviderId,
              model: promptInterpreter.configuration.modelId,
            },
            unity: {
              status: realUnityManager ? 'ready' : 'bypassed',
              version: process.env.UNITY_EDITOR_VERSION ?? 'not-configured',
            },
          },
        };
      },
    },
  );
  const worker = new OrchestratorWorker(
    realUnityManager
      ? {
          store,
          ...(specService ? { specService } : {}),
          interpretPrompt: promptInterpreter.interpret,
          checkpointService: new SourceCheckpointService(
            durableDataPlane?.checkpointService ??
              new InMemoryCheckpointService(),
            (projectId, revision) =>
              realUnityManager.restoreRevision(projectId, revision),
          ),
          sourceRevision: (run) => realUnityManager.sourceRevision(run),
          prepareSource: (run) =>
            realUnityManager.prepareSource(run, (runId) =>
              store.getRunForWorker(runId),
            ),
          settleSource: (run, outcome) =>
            realUnityManager.settleSource(run, outcome),
          restoreSourceVersion: (run, versionId) =>
            realUnityManager.restoreVersion(run, versionId),
          taskExecutorFactory: (input) => realUnityManager.executorFor(input),
          publishPreview: ({ projectId, runId, buildHash, traceId }) =>
            realUnityManager.publish({ projectId, runId, buildHash, traceId }),
        }
      : {
          store,
          interpretPrompt: promptInterpreter.interpret,
          taskExecutor: createLocalTaskExecutor(),
          publishPreview: async ({ projectId, buildHash }) => ({
            healthy: true,
            url: `${supportOrigin}/previews/${encodeURIComponent(projectId)}/${encodeURIComponent(buildHash)}/index.html`,
            buildHash,
            evidence: [
              {
                type: 'preview',
                reference: `fixture://local-dev/preview/${buildHash}`,
                contentHash: buildHash,
              },
            ],
          }),
        },
  );
  const controller = new AbortController();
  const workerLoop = runWorkerLoop(worker, {
    signal: controller.signal,
    pollIntervalMs: Number(process.env.GAMERHUB_WORKER_POLL_MS ?? 1000),
    ...(durableDataPlane
      ? {
          waitForWork: (timeoutMs: number, signal?: AbortSignal) =>
            durableDataPlane?.runSignal.wait(timeoutMs, signal) ??
            Promise.resolve(),
        }
      : {}),
  });
  try {
    await support.listen({ host, port: supportPort });
    await api.listen({ host, port: apiPort });
  } catch (error) {
    controller.abort();
    await Promise.allSettled([
      api.close(),
      support.close(),
      workerLoop,
      durableDataPlane?.close(),
    ]);
    throw error;
  }
  console.log(
    JSON.stringify({
      status: 'ready',
      service: 'gamerhub-local-dev',
      api: `http://${host}:${apiPort}`,
      support: supportOrigin,
      provenance:
        executionMode === 'real-unity'
          ? 'real-unity-local-dev'
          : 'fixture-local-dev',
      executionMode,
      dataMode,
      model: {
        mode: promptInterpreter.configuration.mode,
        requestedProviderId:
          promptInterpreter.configuration.requestedProviderId,
        modelId: promptInterpreter.configuration.modelId,
        awaitingSecret: promptInterpreter.configuration.awaitingSecret,
      },
      note: 'Production and release evidence gates remain fail-closed.',
    }),
  );
  return {
    api,
    support,
    close: async () => {
      controller.abort();
      await Promise.allSettled([
        api.close(),
        support.close(),
        workerLoop,
        durableDataPlane?.close(),
      ]);
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  const runtime = await startLocalDevelopmentRuntime();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await runtime.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}
