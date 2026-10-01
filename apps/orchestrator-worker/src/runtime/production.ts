import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  AssetRepository,
  PostgresAssetMetadataStore,
  S3ObjectStore,
} from '@gamerhub/assets';
import { requireProductionUnityLicenseDecision } from '@gamerhub/contracts';
import { PostgresDomainRepository, type Run } from '@gamerhub/domain';
import {
  EvidenceStore,
  HttpProbeTransport,
  PlaytestProtocolClient,
} from '@gamerhub/playtest';
import { UnityEngineAdapter } from '@gamerhub/unity-adapter';
import {
  GitCheckpointStore,
  PostgresCheckpointMetadataStore,
} from '@gamerhub/versioning';
import { UnityTaskExecutor } from '../executors/unity-task-executor';
import { createConfiguredPromptInterpreter } from '../model/prompt-interpreter';
import {
  OrchestratorWorker,
  type WorkerExecutionContext,
  type WorkerTaskExecutor,
} from '../worker';

interface JsonRecord {
  [key: string]: unknown;
}

export interface ProductionWorkerHandle {
  worker: OrchestratorWorker;
  close(): Promise<void>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name}_REQUIRED`);
  return value;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function endpoint(name: string): string {
  const value = required(name);
  if (!/^https?:\/\//.test(value)) throw new Error(`${name}_INVALID`);
  return value.replace(/\/$/, '');
}

function safePathSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
    throw new Error('UNITY_PROJECT_PATH_TEMPLATE_VALUE_INVALID');
  return value;
}

function projectPathFor(template: string, projectId: string, runId: string) {
  const path = template
    .replaceAll('{projectId}', safePathSegment(projectId))
    .replaceAll('{runId}', safePathSegment(runId));
  if (path.includes('{') || !isAbsolute(path))
    throw new Error('UNITY_PROJECT_PATH_TEMPLATE_INVALID');
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory())
    throw new Error('UNITY_RUN_WORKSPACE_NOT_FOUND');
  return resolved;
}

function assetIdFromPrompt(prompt: string): string {
  const match =
    /(?:替换|换成|replace)[\s\S]{0,40}?(?:素材|asset)\s*(?:id|编号)?\s*[:#：]?\s*([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(
      prompt,
    );
  if (!match?.[1]) throw new Error('ASSET_ID_REQUIRED');
  return match[1];
}

function projectAssetPath(projectPath: string, targetPath: string): string {
  if (
    !targetPath.startsWith('Assets/') ||
    targetPath.includes('..') ||
    targetPath.includes('\\') ||
    targetPath.includes('\0')
  )
    throw new Error('WORKSPACE_ESCAPE');
  const resolved = resolve(projectPath, targetPath);
  const relativePath = relative(projectPath, resolved);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  )
    throw new Error('WORKSPACE_ESCAPE');
  return resolved;
}

function packageLockHash(): string {
  const path = resolve(
    process.env.GAMERHUB_PACKAGE_LOCK_PATH ?? 'pnpm-lock.yaml',
  );
  if (!existsSync(path)) throw new Error('PACKAGE_LOCK_REQUIRED');
  return `sha256-${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

async function postJson(url: string, payload: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('REMOTE_JSON_INVALID');
    }
  }
  if (!response.ok) throw new Error(`REMOTE_HTTP_${response.status}`);
  return record(body);
}

function evidenceFromRemote(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const value = record(item);
    return typeof value.type === 'string' && typeof value.reference === 'string'
      ? [
          {
            type: value.type,
            reference: value.reference,
            ...(typeof value.contentHash === 'string'
              ? { contentHash: value.contentHash }
              : {}),
          },
        ]
      : [];
  });
}

function createRunExecutorFactory(input: {
  store: PostgresDomainRepository;
  editorPath: string;
  cliPath?: string;
  projectPathTemplate: string;
  probeEndpoint: string;
  evaluatorEndpoint: string;
  packageLockHash: string;
  assetRepository: AssetRepository;
  rollbackAsset: (input: {
    run: Run;
    context: WorkerExecutionContext;
  }) => Promise<void>;
}): (input: {
  run: Run;
  context: WorkerExecutionContext;
}) => Promise<WorkerTaskExecutor> {
  const executors = new Map<string, UnityTaskExecutor>();
  return async ({ run, context }) => {
    const existing = executors.get(run.id);
    if (existing) return existing;
    if (
      !context.specVersionId ||
      !context.checkpointId ||
      !context.checkpointRef
    )
      throw new Error('UNITY_EXECUTOR_PROVENANCE_REQUIRED');
    const projectPath = projectPathFor(
      input.projectPathTemplate,
      run.projectId,
      run.id,
    );
    const probe = new PlaytestProtocolClient(
      {
        projectRevision: context.checkpointRef,
        gameSpecVersion: context.specVersionId,
      },
      {
        transport: new HttpProbeTransport({ endpoint: input.probeEndpoint }),
      },
    );
    const adapter = new UnityEngineAdapter({
      editorPath: input.editorPath,
      projectPath,
      ...(input.cliPath ? { cliPath: input.cliPath } : {}),
    });
    const executor = new UnityTaskExecutor({
      adapter,
      projectPath,
      probeClient: probe,
      evidenceStore: new EvidenceStore(),
      durableStore: input.store,
      projectId: run.projectId,
      specVersionId: context.specVersionId,
      checkpointId: context.checkpointId,
      checkpointRef: context.checkpointRef,
      stageAsset: async ({ targetPath }) => {
        const assetId = assetIdFromPrompt(run.userInput);
        const { asset, bytes } = await input.assetRepository.readAsset(
          run.projectId,
          assetId,
        );
        if (asset.importStatus === 'failed')
          throw new Error('ASSET_IMPORT_PREVIOUSLY_FAILED');
        const destination = projectAssetPath(projectPath, targetPath);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
      },
      onAssetImported: async ({ targetPath }) => {
        const assetId = assetIdFromPrompt(run.userInput);
        await input.assetRepository.updateImportStatus(
          run.projectId,
          assetId,
          'imported',
        );
        if (!context.specVersionId)
          throw new Error('ASSET_IMPORT_SPEC_VERSION_REQUIRED');
        await input.assetRepository.addUsage({
          assetId,
          projectId: run.projectId,
          logicalEntityId: 'player',
          relativePath: targetPath,
          usageKind: 'player',
          introducedSpecVersionId: context.specVersionId,
        });
      },
      onAssetImportFailed: async () => {
        const assetId = assetIdFromPrompt(run.userInput);
        await input.assetRepository.updateImportStatus(
          run.projectId,
          assetId,
          'failed',
        );
      },
      packageLockHash: input.packageLockHash,
      templateVersion:
        process.env.GAMERHUB_TEMPLATE_VERSION ?? 'runner-template-1.0.0',
      rollbackAsset: () =>
        input.rollbackAsset({
          run,
          context,
        }),
      parameterValues: {
        jump_height:
          /(?:跳跃|jump)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i.exec(
            run.userInput,
          )?.[1] ?? '',
      },
      evaluate: async ({ task, evidence }) => {
        const body = await postJson(input.evaluatorEndpoint, {
          run_id: run.id,
          task_id: task.id,
          evidence,
        });
        if (typeof body.passed !== 'boolean')
          throw new Error('EVALUATOR_RESULT_INVALID');
        const reportKey =
          typeof body.report_key === 'string' ? body.report_key : undefined;
        return {
          passed: body.passed,
          evidence: evidenceFromRemote(body.evidence),
          ...(reportKey ? { reportKey } : {}),
          evaluatorVersion:
            typeof body.evaluator_version === 'string'
              ? body.evaluator_version
              : 'http-evaluator',
        };
      },
    });
    executors.set(run.id, executor);
    return executor;
  };
}

export function createProductionWorker(): ProductionWorkerHandle {
  requireProductionUnityLicenseDecision();
  if (!/^secret:\/\/\S+$/.test(required('UNITY_LICENSE_REF')))
    throw new Error('UNITY_LICENSE_REF_INVALID');
  const promptInterpreter = createConfiguredPromptInterpreter(process.env, {
    allowFixture: false,
  });
  const store = PostgresDomainRepository.fromEnvironment();
  const objectStore = new S3ObjectStore({
    endpoint: required('OBJECT_STORAGE_ENDPOINT'),
    region: required('OBJECT_STORAGE_REGION'),
    bucket: required('OBJECT_STORAGE_BUCKET'),
    accessKeyId: required('OBJECT_STORAGE_ACCESS_KEY'),
    secretAccessKey: required('OBJECT_STORAGE_SECRET_KEY'),
  });
  const assetRepository = new AssetRepository({
    objectStore,
    metadataStore: new PostgresAssetMetadataStore(store.pool),
  });
  const workspaceRepoPath = required('GAMERHUB_WORKSPACE_REPO_PATH');
  const checkpointStore = new GitCheckpointStore({
    repoPath: workspaceRepoPath,
    metadataStore: new PostgresCheckpointMetadataStore(store.pool),
  });
  const editorPath = required('UNITY_EDITOR_PATH');
  const projectPathTemplate = required('GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE');
  const evaluatorEndpoint = endpoint('EVALUATOR_ENDPOINT');
  const probeEndpoint = endpoint('PLAYTEST_PROBE_ENDPOINT');
  const previewEndpoint = endpoint('PREVIEW_PUBLISHER_ENDPOINT');
  const factory = createRunExecutorFactory({
    store,
    editorPath,
    ...(process.env.UNITY_CLI_PATH
      ? { cliPath: process.env.UNITY_CLI_PATH }
      : {}),
    projectPathTemplate,
    probeEndpoint,
    evaluatorEndpoint,
    packageLockHash: packageLockHash(),
    assetRepository,
    rollbackAsset: async ({ run, context }) => {
      if (!context.checkpointId)
        throw new Error('ASSET_ROLLBACK_CHECKPOINT_REQUIRED');
      await checkpointStore.restore(context.checkpointId, run.projectId);
    },
  });
  const worker = new OrchestratorWorker({
    store,
    interpretPrompt: promptInterpreter.interpret,
    taskExecutorFactory: factory,
    publishPreview: async ({
      projectId,
      runId,
      traceId,
      buildHash,
      evidence,
    }) => {
      const body = await postJson(previewEndpoint, {
        project_id: projectId,
        run_id: runId,
        trace_id: traceId,
        build_hash: buildHash,
        evidence,
      });
      const url = typeof body.url === 'string' ? body.url : '';
      return {
        healthy: body.healthy === true && /^https?:\/\//.test(url),
        url,
        ...(typeof body.build_hash === 'string'
          ? { buildHash: body.build_hash }
          : {}),
        evidence: evidenceFromRemote(body.evidence),
      };
    },
  });
  return {
    worker,
    close: async () => {
      await store.pool.end?.();
    },
  };
}
