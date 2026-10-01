/** Framework-independent domain/Unity process. stdin/stdout RPC only: no HTTP listener. */

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { type ArtPlan, gameCapabilities, specArt } from '@gamerhub/game-spec';
import {
  createConfiguredPromptInterpreter,
  OrchestratorWorker,
  runWorkerLoop,
} from '@gamerhub/orchestrator-worker';
import { requireProductionUnityLicenseDecision } from '../../../packages/contracts/src/config/env.schema';
import {
  createPlatformApi,
  type PlatformRequest,
} from '../../platform-api/src/app';
import { DesignService } from '../../platform-api/src/services/design-service';
import { ArtStore } from './art-store';
import { createPostgresRedisDataPlane } from './data-plane';
import { loadLocalEnvironment } from './environment';
import { inspectUnityComponents } from './local-readiness';
import { LocalGameSpecVersionService } from './local-version-service';
import {
  acceptPythonResponse,
  PythonPiActionRuntime,
  PythonPiModelProvider,
  pythonCallback,
} from './python-agent';
import { RealUnityLocalManager, RealUnityPreviewReader } from './real-unity';
import { SourceCheckpointService } from './source-checkpoints';

loadLocalEnvironment();
if (process.env.NODE_ENV === 'production')
  requireProductionUnityLicenseDecision();
const ownerId =
  process.env.GAMERHUB_API_USER_ID ??
  process.env.GAMERHUB_LOCAL_USER_ID ??
  '00000000-0000-4000-8000-000000000001';
const supportOrigin = `http://127.0.0.1:${Number(process.env.LOCAL_SUPPORT_PORT ?? 3010)}`;
type Params = Record<string, unknown>;
type Result = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};
const ok = (body: unknown, status = 200): Result => ({ status, body });
const string = (p: Params, key: string) => String(p[key] ?? '');

async function main() {
  const data = await createPostgresRedisDataPlane(supportOrigin, ownerId);
  const api = createPlatformApi(
    { userId: ownerId, role: 'creator' },
    {
      store: data.store,
      onRunAccepted: async (run) => ({
        transport: 'redis-pubsub',
        delivered: await data.runSignal.notify(run.id, run.traceId),
      }),
    },
  );
  const designs = new DesignService(
    data.store,
    ownerId,
    api,
    new PythonPiModelProvider(),
    async (projectId, document) => {
      const assets = await data.assetRepository.list(projectId);
      for (const item of [...document.nodes, ...document.sounds])
        if (item.assetId) {
          const asset = assets.find(
            (asset) =>
              asset.id === item.assetId &&
              asset.contentHash === item.contentHash &&
              asset.securityStatus === 'approved',
          );
          const audio = 'source' in item;
          if (
            !asset ||
            (audio
              ? asset.mediaType !== 'audio/wav'
              : !['image/png', 'image/jpeg'].includes(asset.mediaType))
          )
            throw Object.assign(new Error('CREATIVE_ASSET_INVALID'), {
              code: 'CREATIVE_ASSET_INVALID',
              statusCode: 400,
            });
        }
    },
  );
  const art = new ArtStore(data.store, ownerId, data.assetRepository);
  const versions = new LocalGameSpecVersionService(
    data.store,
    data.specService,
    ownerId,
  );
  const interpreter = createConfiguredPromptInterpreter(process.env, {
    allowFixture: false,
  });
  let unity: RealUnityLocalManager | undefined;
  const previews = new RealUnityPreviewReader({
    workspaceRoot:
      process.env.GAMERHUB_LOCAL_UNITY_WORKSPACE_ROOT ??
      resolve('unity/LocalProjects'),
    durableStore: data.store,
  });
  const getUnity = () => {
    if (!inspectUnityComponents(process.env).ready)
      throw Object.assign(new Error('UNITY_NOT_READY'), {
        code: 'UNITY_NOT_READY',
        statusCode: 503,
      });
    unity ??= new RealUnityLocalManager({
      editorPath: process.env.UNITY_EDITOR_PATH ?? '',
      templatePath: process.env.UNITY_GOLDEN_PROJECT ?? '',
      workspaceRoot:
        process.env.GAMERHUB_LOCAL_UNITY_WORKSPACE_ROOT ??
        resolve('unity/LocalProjects'),
      publicOrigin: supportOrigin,
      durableStore: data.store,
      assetRepository: data.assetRepository,
    });
    return unity;
  };
  const worker = new OrchestratorWorker({
    agentKernel: new PythonPiActionRuntime(data.store, ownerId),
    store: data.store,
    specService: data.specService,
    interpretPrompt: interpreter.interpret,
    checkpointService: new SourceCheckpointService(
      data.checkpointService,
      (projectId, revision) => getUnity().restoreRevision(projectId, revision),
    ),
    sourceRevision: (run) => getUnity().sourceRevision(run),
    prepareSource: (run) =>
      getUnity().prepareSource(run, (runId) =>
        data.store.getRunForWorker(runId),
      ),
    settleSource: (run, outcome) => getUnity().settleSource(run, outcome),
    restoreSourceVersion: (run, versionId) =>
      getUnity().restoreVersion(run, versionId),
    taskExecutorFactory: (input) => getUnity().executorFor(input),
    publishPreview: ({ projectId, runId, buildHash, traceId }) =>
      getUnity().publish({ projectId, runId, buildHash, traceId }),
  });
  const controller = new AbortController();
  const loop = runWorkerLoop(worker, {
    signal: controller.signal,
    pollIntervalMs: 1000,
    waitForWork: (timeout, signal) => data.runSignal.wait(timeout, signal),
  });
  await art.recover();
  const platform = (method: 'GET' | 'POST', path: string, p: Params) =>
    api.request({
      method,
      path,
      body: p.body,
      headers: (p.headers ?? {}) as NonNullable<PlatformRequest['headers']>,
    });
  async function dispatch(operation: string, p: Params): Promise<Result> {
    if (operation === 'pi.callback')
      return ok(
        await pythonCallback(
          string(p, 'requestId'),
          string(p, 'name'),
          (p.body ?? {}) as Params,
        ),
      );
    if (operation === 'capabilities.get')
      return ok({ capabilities: gameCapabilities });
    const projectId = string(p, 'projectId');
    const projectPath = `/v1/projects/${encodeURIComponent(projectId)}`;
    const runPath = `${projectPath}/runs/${encodeURIComponent(string(p, 'runId'))}`;
    if (operation === 'health') {
      const plane = await data.health();
      const components = inspectUnityComponents(process.env);
      const modelReady = !interpreter.configuration.awaitingSecret;
      return ok({
        status:
          plane.postgres.status === 'ready' &&
          plane.objectStorage.status === 'ready' &&
          components.ready &&
          modelReady
            ? 'ready'
            : 'blocked',
        service: 'platform-api',
        provenance: 'real-unity-local-dev',
        executionMode: 'real-unity',
        creationReady:
          components.ready &&
          modelReady &&
          plane.postgres.status === 'ready' &&
          plane.objectStorage.status === 'ready',
        dataPlane: plane,
        services: {
          model: {
            status: interpreter.configuration.awaitingSecret
              ? 'degraded'
              : 'ready',
            provider: interpreter.configuration.requestedProviderId,
            model: interpreter.configuration.modelId,
          },
          unity: {
            status: components.ready ? 'ready' : 'blocked',
            ...components,
            version: process.env.UNITY_EDITOR_VERSION ?? 'configured',
          },
        },
      });
    }
    if (operation === 'projects.list')
      return platform('GET', '/v1/projects', p);
    if (operation === 'projects.create')
      return platform('POST', '/v1/projects', p);
    if (operation === 'projects.get') return platform('GET', projectPath, p);
    if (operation.startsWith('preview.')) {
      if (operation !== 'preview.resolve')
        return ok({ code: 'RPC_METHOD_UNKNOWN' }, 400);
      const preview = await previews.preview(projectId, string(p, 'buildHash'));
      return preview ? ok(preview) : ok({ code: 'PREVIEW_NOT_FOUND' }, 404);
    }
    await data.store.getProject(projectId, { ownerId });
    if (
      [
        'runs.create',
        'runs.resume',
        'design.confirm',
        'versions.restore',
        'assets.replace',
      ].includes(operation)
    )
      getUnity();
    const body = (p.body ?? {}) as Params;
    switch (operation) {
      case 'creative.get':
        return ok(await designs.getCreative(projectId));
      case 'creative.save':
        return ok(
          await designs.saveCreative(
            projectId,
            Number(body.revision),
            body.document,
          ),
        );
      case 'creative.suggest':
        return ok(
          await designs.suggestCreative(
            projectId,
            Number(body.revision),
            body.prompt,
          ),
        );
      case 'creative.apply': {
        getUnity();
        const prepared = await designs.prepare(
          projectId,
          Number(body.revision),
        );
        return ok(await designs.confirm(projectId, prepared.revision), 202);
      }
      case 'runs.list':
        return platform('GET', `${projectPath}/runs`, p);
      case 'runs.create':
        return platform('POST', `${projectPath}/runs`, p);
      case 'runs.get':
        return platform('GET', runPath, p);
      case 'runs.trace':
        return platform('GET', `${runPath}/trace`, p);
      case 'runs.events':
        return platform(
          'GET',
          `${runPath}/events?after=${Number(p.after) || 0}`,
          p,
        );
      case 'runs.pause':
      case 'runs.resume':
      case 'runs.cancel':
        return platform('POST', `${runPath}/${operation.split('.')[1]}`, p);
      case 'design.get':
        return ok({
          ...(await designs.get(projectId)),
          appliedGenre: (await designs.currentSpec(projectId))?.game.genre,
        });
      case 'design.message':
        return ok(
          await designs.message(
            projectId,
            Number(body.revision),
            body.message,
            body.creationMode,
          ),
        );
      case 'design.prepare':
        return ok(await designs.prepare(projectId, Number(body.revision)));
      case 'design.confirm':
        return ok(await designs.confirm(projectId, Number(body.revision)));
      case 'versions.list':
        return ok({ items: await versions.list(projectId) });
      case 'versions.restore':
        return ok(
          await versions.restore(
            projectId,
            string(p, 'versionId'),
            string(p, 'key'),
          ),
          202,
        );
      case 'assets.list':
        return ok({ items: await data.assetRepository.list(projectId) });
      case 'assets.upload': {
        if (body.created_by_run_id)
          await data.store.getRun(projectId, String(body.created_by_run_id), {
            ownerId,
          });
        const asset = await data.assetRepository.upload({
          projectId,
          createdByRunId: String(body.created_by_run_id ?? 'api-upload'),
          name: String(body.name),
          mimeType: String(body.mime_type),
          bytes: Buffer.from(String(body.bytes_base64), 'base64'),
          licenseText: String(body.license_text ?? ''),
        });
        return ok(asset, 201);
      }
      case 'assets.content': {
        const { asset, bytes } = await data.assetRepository.readAsset(
          projectId,
          string(p, 'assetId'),
        );
        return ok({
          bytes_base64: Buffer.from(bytes).toString('base64'),
          mime_type: asset.mediaType,
        });
      }
      case 'assets.replace': {
        const { asset } = await data.assetRepository.readAsset(
          projectId,
          string(p, 'assetId'),
        );
        return platform('POST', `${projectPath}/runs`, {
          ...p,
          body: {
            request_type: 'modify',
            prompt: `替换角色为素材 ${asset.id}`,
          },
        });
      }
      case 'art.get': {
        const plan = await art.get(projectId);
        return ok({
          ...plan,
          applied: specArt(await designs.currentSpec(projectId)) ?? null,
        });
      }
      case 'art.brief':
        return ok(await art.brief(projectId, string(p, 'prompt')));
      case 'art.save': {
        await designs.get(projectId);
        return ok(
          await art.save(
            projectId,
            Number(p.revision),
            p.document as ArtPlan,
            Boolean(p.select),
          ),
        );
      }
      default:
        return ok({ code: 'RPC_METHOD_UNKNOWN' }, 400);
    }
  }
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    if (line.length > 12 * 1024 * 1024) return;
    void (async () => {
      let id: string | undefined;
      let result: Result;
      try {
        const request = JSON.parse(line) as {
          id: string;
          operation: string;
          params?: Params;
        };
        if (acceptPythonResponse(request as unknown as Params)) return;
        id = request.id;
        if (!id || typeof request.operation !== 'string')
          throw new Error('RPC_INVALID');
        result = await dispatch(request.operation, request.params ?? {});
      } catch (error) {
        const e = error as {
          code?: string;
          message?: string;
          statusCode?: number;
        };
        const code = e.code ?? e.message ?? 'INTERNAL_ERROR';
        const status =
          e.statusCode ??
          (/NOT_FOUND/.test(code)
            ? 404
            : [
                  'PROJECT_RUN_ACTIVE',
                  'IDEMPOTENCY_CONFLICT',
                  'RUN_INVALID_TRANSITION',
                ].includes(code)
              ? 409
              : /^(ART_|AUDIO_|CREATIVE_|SIZE_LIMIT|MIME_MISMATCH|DECODE_BOMB|LICENSE_REQUIRED|WORKSPACE_ESCAPE)/.test(
                    code,
                  )
                ? 400
                : 500);
        result = ok({ code: status === 500 ? 'INTERNAL_ERROR' : code }, status);
        if (status === 500)
          process.stderr.write(
            `Domain operation failed: ${/^[A-Z0-9_]+$/.test(code) ? code : 'INTERNAL_ERROR'}\n`,
          );
      }
      process.stdout.write(`${JSON.stringify({ id, ...result })}\n`);
    })();
  });
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
  await new Promise<void>((resolve) => {
    const stop = () => {
      controller.abort();
      input.close();
      resolve();
    };
    input.once('close', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await loop;
  await data.close();
}
void main().catch(() => {
  process.stderr.write('DOMAIN_RUNTIME_START_FAILED\n');
  process.exitCode = 1;
});
