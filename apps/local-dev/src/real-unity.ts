import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { AssetRepository } from '@gamerhub/assets';
import {
  type PostgresDomainRepository,
  type Run,
  traceIdFromRunId,
} from '@gamerhub/domain';
import type { EngineAdapter } from '@gamerhub/engine-adapter';
import { developmentAcceptance } from '@gamerhub/game-planner';
import {
  artRoles,
  assessMechanisms,
  developmentFor,
  type GameSpec,
  gameplayProfile,
  gameplayTestSuites,
  parseCreative,
  specArt,
} from '@gamerhub/game-spec';
import {
  UnityTaskExecutor,
  type WorkerExecutionContext,
  type WorkerTaskExecutor,
} from '@gamerhub/orchestrator-worker';
import { UnityEngineAdapter } from '@gamerhub/unity-adapter';
import type { FastifyInstance } from 'fastify';
import { applyArtBindings } from './apply-art';
import { applyCreative } from './apply-creative';
import {
  type BrowserBuildResult,
  inspectBrowserBuild,
} from './browser-playtest';
import { SourceAttemptStore } from './source-attempt';
import {
  recordSourceVersion,
  restoreSource,
  restoreSourceVersion,
  snapshotSource,
} from './source-snapshot';
import { migrateTemplate } from './template-migration';

const projectDirectories = ['Assets', 'Packages', 'ProjectSettings'] as const;

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error(`LOCAL_UNITY_${label}_INVALID`);
  return value;
}

function assertFile(path: string, code: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(code);
}

function assertDirectory(path: string, code: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(code);
}

async function hashDirectory(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) {
        hash.update(relative(root, child).replaceAll('\\', '/'));
        hash.update(await readFile(child));
      }
    }
  };
  await visit(root);
  return `sha256-${hash.digest('hex')}`;
}

function systemNumber(
  spec: GameSpec,
  systemId: string,
  key: string,
  fallback: number,
): number {
  const value = spec.systems.find(
    (item) => item.type === systemId && item.enabled,
  )?.config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface GeneratedRunnerConfig {
  gameName: string;
  description: string;
  playerSpeed: number;
  jumpVelocity: number;
  scorePerCoin: number;
  spawnIntervalSeconds: number;
  levelDurationSeconds: number;
  playerAssetId: string;
  specVersionId: string;
}

export function runnerConfigFromSpec(
  spec: GameSpec,
  specVersionId: string,
): GeneratedRunnerConfig {
  return {
    gameName: spec.game.name,
    description: spec.game.description ?? '',
    playerSpeed: spec.player.movement.speed,
    jumpVelocity: spec.player.movement.jump_height,
    scorePerCoin: systemNumber(spec, 'coin_collection', 'score_per_coin', 10),
    spawnIntervalSeconds: systemNumber(spec, 'spawn', 'interval_seconds', 2),
    levelDurationSeconds: spec.level.duration_seconds,
    playerAssetId: spec.player.appearance.logical_asset_id,
    specVersionId,
  };
}

export function gameConfigFromSpec(spec: GameSpec, specVersionId: string) {
  const profile = gameplayProfile(spec);
  return {
    ...runnerConfigFromSpec(spec, specVersionId),
    runtime: profile.runtime,
    genre: spec.game.genre,
    maxHp: spec.player.health.max_hp,
    enemyHp: systemNumber(spec, 'combat', 'enemy_hp', 2),
    enemySpeed: systemNumber(spec, 'combat', 'enemy_speed', 1),
    damage: systemNumber(spec, 'combat', 'damage', 1),
    attackInterval: systemNumber(spec, 'combat', 'interval_seconds', 0.7),
    attackRange: systemNumber(spec, 'combat', 'range', 5),
    xpPerLevel: systemNumber(spec, 'xp', 'per_level', 3),
    upgradeCost: systemNumber(spec, 'level_up', 'upgrade_cost', 30),
    goal: systemNumber(spec, 'score', 'goal', 300),
    autoIncome: systemNumber(spec, 'score', 'auto_income', 0),
    scorePerCoin: systemNumber(
      spec,
      spec.game.genre === 'clicker' ? 'score' : 'coin_collection',
      spec.game.genre === 'clicker' ? 'per_click' : 'score_per_coin',
      10,
    ),
    ...assessMechanisms(spec).config,
  };
}

export interface RealUnityPreview {
  projectId: string;
  runId: string;
  buildHash: string;
  traceId: string;
  root: string;
}

export interface RealUnityLocalManagerOptions {
  editorPath: string;
  templatePath: string;
  workspaceRoot: string;
  publicOrigin: string;
  durableStore?: PostgresDomainRepository;
  assetRepository?: AssetRepository;
  browserInspector?: typeof inspectBrowserBuild;
  adapterFactory?: (input: {
    editorPath: string;
    projectPath: string;
  }) => EngineAdapter;
}

/** Published WebGL files remain readable even when the editor is unavailable. */
export class RealUnityPreviewReader {
  protected readonly previews = new Map<string, RealUnityPreview>();

  constructor(
    private readonly previewOptions: Pick<
      RealUnityLocalManagerOptions,
      'workspaceRoot' | 'durableStore'
    >,
  ) {}

  async preview(
    projectIdValue: string,
    buildHash: string,
  ): Promise<RealUnityPreview | undefined> {
    const projectId = safeSegment(projectIdValue, 'PROJECT_ID');
    if (!/^sha256-[a-f0-9]{64}$/.test(buildHash))
      throw new Error('LOCAL_UNITY_BUILD_HASH_INVALID');
    const key = this.previewKey(projectId, buildHash);
    const known = this.previews.get(key);
    if (known) return known;
    for (const build of await this.buildDirectories(projectId)) {
      if (!existsSync(join(build.root, 'index.html'))) continue;
      if ((await hashDirectory(build.root)) !== buildHash) continue;
      const recovered = {
        projectId,
        runId: build.runId,
        traceId: this.previewOptions.durableStore
          ? (
              await this.previewOptions.durableStore.getRunForWorker(
                build.runId,
              )
            ).traceId
          : traceIdFromRunId(build.runId),
        buildHash,
        root: build.root,
      };
      this.previews.set(key, recovered);
      return recovered;
    }
    return undefined;
  }

  protected previewKey(projectId: string, buildHash: string): string {
    return `${projectId}:${buildHash}`;
  }

  protected async buildDirectories(
    projectIdValue: string,
  ): Promise<Array<{ runId: string; root: string; modifiedAt: number }>> {
    const projectId = safeSegment(projectIdValue, 'PROJECT_ID');
    const buildsRoot = resolve(
      this.previewOptions.workspaceRoot,
      projectId,
      'Builds',
      'Web',
    );
    if (!existsSync(buildsRoot)) return [];
    const entries = await readdir(buildsRoot, { withFileTypes: true });
    const builds = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name))
        continue;
      const root = join(buildsRoot, entry.name);
      builds.push({
        runId: entry.name,
        root,
        modifiedAt: (await stat(root)).mtimeMs,
      });
    }
    return builds;
  }
}

export class RealUnityLocalManager extends RealUnityPreviewReader {
  private readonly executors = new Map<string, Promise<WorkerTaskExecutor>>();
  private readonly revisions = new Map<string, string>();

  constructor(private readonly options: RealUnityLocalManagerOptions) {
    super(options);
    assertFile(options.editorPath, 'UNITY_EDITOR_NOT_FOUND');
    assertDirectory(options.templatePath, 'UNITY_TEMPLATE_NOT_FOUND');
    assertFile(
      join(options.templatePath, 'ProjectSettings', 'ProjectVersion.txt'),
      'UNITY_TEMPLATE_INVALID',
    );
  }

  async executorFor(input: {
    run: Run;
    context: WorkerExecutionContext;
  }): Promise<WorkerTaskExecutor> {
    let executor = this.executors.get(input.run.id);
    if (!executor) {
      executor = this.createExecutor(input);
      this.executors.set(input.run.id, executor);
    }
    return executor;
  }

  async sourceRevision(run: Run): Promise<string> {
    const projectPath = resolve(
      this.options.workspaceRoot,
      safeSegment(run.projectId, 'PROJECT_ID'),
    );
    await this.ensureWorkspace(projectPath);
    return snapshotSource(projectPath);
  }

  async prepareSource(
    run: Run,
    resolveRun: (runId: string) => Promise<Run>,
  ): Promise<void> {
    const projectPath = resolve(
      this.options.workspaceRoot,
      safeSegment(run.projectId, 'PROJECT_ID'),
    );
    await this.ensureWorkspace(projectPath);
    await new SourceAttemptStore(projectPath, run.projectId).begin(
      run.id,
      async (runId) => {
        const other = await resolveRun(runId);
        if (other.projectId !== run.projectId)
          throw new Error('SOURCE_ATTEMPT_PROJECT_MISMATCH');
        return other.status;
      },
    );
  }

  async settleSource(run: Run, outcome: 'succeeded' | 'failed' | 'cancelled') {
    const projectPath = resolve(
      this.options.workspaceRoot,
      safeSegment(run.projectId, 'PROJECT_ID'),
    );
    try {
      const result = await new SourceAttemptStore(
        projectPath,
        run.projectId,
      ).settle(run.id, outcome);
      return {
        status: result.status,
        archived: Boolean(result.archivedRevision),
      };
    } finally {
      this.executors.delete(run.id);
    }
  }

  async restoreVersion(run: Run, versionId: string): Promise<void> {
    const projectPath = resolve(
      this.options.workspaceRoot,
      safeSegment(run.projectId, 'PROJECT_ID'),
    );
    await restoreSourceVersion(projectPath, versionId);
  }

  async restoreRevision(projectId: string, revision: string): Promise<void> {
    await restoreSource(
      join(this.options.workspaceRoot, safeSegment(projectId, 'PROJECT_ID')),
      revision,
    );
  }

  async publish(input: {
    projectId: string;
    runId: string;
    traceId: string;
    buildHash: string;
    specVersionId?: string;
  }): Promise<{
    healthy: boolean;
    url: string;
    buildHash: string;
    previewId?: string;
    browser?: BrowserBuildResult;
    evidence: Array<{
      type: string;
      reference: string;
      contentHash: string;
    }>;
  }> {
    const projectId = safeSegment(input.projectId, 'PROJECT_ID');
    const runId = safeSegment(input.runId, 'RUN_ID');
    const root = resolve(
      this.options.workspaceRoot,
      projectId,
      'Builds',
      'Web',
      runId,
    );
    assertDirectory(root, 'UNITY_WEB_BUILD_NOT_FOUND');
    assertFile(join(root, 'index.html'), 'UNITY_WEB_INDEX_NOT_FOUND');
    const buildHash = await hashDirectory(root);
    const projectPath = resolve(this.options.workspaceRoot, projectId);
    const config = JSON.parse(
      await readFile(
        join(projectPath, 'Assets/Resources/GamerHubGameConfig.json'),
        'utf8',
      ),
    );
    const specVersionId = safeSegment(config.specVersionId, 'SPEC_VERSION_ID');
    if (input.specVersionId && input.specVersionId !== specVersionId)
      throw Object.assign(new Error('构建配置与本次制作版本不符。'), {
        code: 'BROWSER_IDENTITY_MISMATCH',
      });
    const creativeJson = await readFile(
      join(projectPath, 'Assets/Resources/GamerHubCreative.json'),
      'utf8',
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    const creativeDocument = creativeJson
      ? parseCreative(JSON.parse(creativeJson))
      : undefined;
    const creative =
      creativeDocument &&
      creativeDocument.nodes.length +
        creativeDocument.clips.length +
        creativeDocument.sounds.length >
        0
        ? {
            contentHash: `sha256-${createHash('sha256')
              .update(creativeJson as string)
              .digest('hex')}`,
            nodes: creativeDocument.nodes.length,
            clips: creativeDocument.clips.length,
            sounds: creativeDocument.sounds.length,
          }
        : undefined;
    const browser = await (
      this.options.browserInspector ?? inspectBrowserBuild
    )({
      root,
      evidenceDirectory: join(projectPath, '.gamerhub', 'evidence', runId),
      buildHash,
      runId,
      specVersionId,
      runtime: config.runtime,
      genre: config.genre,
      ...(creative ? { creative } : {}),
      autoIncome: typeof config.autoIncome === 'number' ? config.autoIncome : 0,
    });
    if (
      !browser.passed ||
      browser.buildHash !== buildHash ||
      browser.runId !== runId ||
      browser.specVersionId !== specVersionId
    )
      throw Object.assign(new Error('浏览器试玩未通过，当前构建尚未交付。'), {
        code: browser.code ?? 'BROWSER_EVIDENCE_MISMATCH',
      });
    if ((await hashDirectory(root)) !== buildHash)
      throw Object.assign(
        new Error('试玩期间构建文件发生变化，需要重新验证。'),
        { code: 'BROWSER_BUILD_CHANGED' },
      );
    await recordSourceVersion(projectPath, specVersionId);
    const key = this.previewKey(projectId, buildHash);
    this.previews.set(key, {
      projectId,
      runId,
      traceId: input.traceId,
      buildHash,
      root,
    });
    this.revisions.set(projectId, buildHash);
    const previewId = this.options.durableStore
      ? await this.options.durableStore.savePreview({
          projectId,
          sourceRunId: runId,
          buildContentHash: buildHash,
          buildArtifactKey: root,
          publicSlug: `${projectId}/${buildHash}`,
          origin: this.options.publicOrigin,
          status: 'prepared',
        })
      : undefined;
    const url = `${this.options.publicOrigin}/real-previews/${encodeURIComponent(projectId)}/${encodeURIComponent(buildHash)}/index.html`;
    return {
      healthy: true,
      browser,
      ...(previewId ? { previewId } : {}),
      url,
      buildHash,
      evidence: [
        {
          type: 'preview',
          reference: `unity-webgl://${projectId}/${runId}`,
          contentHash: buildHash,
        },
        {
          type: 'browser',
          reference: `browser://${runId}/${specVersionId}`,
          contentHash: browser.reportHash,
        },
      ],
    };
  }

  private async createExecutor(input: {
    run: Run;
    context: WorkerExecutionContext;
  }): Promise<WorkerTaskExecutor> {
    if (!input.context.gameSpec || !input.context.specVersionId)
      throw new Error('LOCAL_UNITY_GAME_SPEC_REQUIRED');
    const projectId = safeSegment(input.run.projectId, 'PROJECT_ID');
    const projectPath = resolve(this.options.workspaceRoot, projectId);
    await this.ensureWorkspace(projectPath);
    const resourceAssetPaths = artRoles.map(
      (role) => `Assets/Resources/Art/${role}.png`,
    );
    const artSnapshot = await Promise.all(
      [...resourceAssetPaths, 'Assets/Resources/GamerHubArtBindings.json'].map(
        async (path) => ({
          path: join(projectPath, path),
          bytes: await readFile(join(projectPath, path)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
              return undefined;
            },
          ),
        }),
      ),
    );
    if (input.run.requestType !== 'rollback')
      await this.syncCuratedRuntime(projectPath);
    if (
      input.run.requestType !== 'rollback' &&
      input.context.gameSpec.extensions?.gamerhub_art
    ) {
      if (!this.options.assetRepository)
        throw new Error('ART_REPOSITORY_REQUIRED');
      await applyArtBindings(
        projectPath,
        projectId,
        input.context.gameSpec,
        this.options.assetRepository,
      );
    }
    if (input.run.requestType !== 'rollback')
      await applyCreative(
        projectPath,
        projectId,
        input.context.gameSpec,
        this.options.assetRepository,
      );
    const packageLockHash = `sha256-${createHash('sha256')
      .update(
        await readFile(join(projectPath, 'Packages', 'packages-lock.json')),
      )
      .digest('hex')}`;
    const profile = gameplayProfile(input.context.gameSpec);
    const generatedConfig = gameConfigFromSpec(
      input.context.gameSpec,
      input.context.specVersionId,
    );
    const configPath = join(
      projectPath,
      'Assets',
      'Resources',
      'GamerHubGameConfig.json',
    );
    await mkdir(join(projectPath, 'Assets', 'Resources'), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(generatedConfig, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'w',
      },
    );
    const adapter =
      this.options.adapterFactory?.({
        editorPath: this.options.editorPath,
        projectPath,
      }) ??
      new UnityEngineAdapter({
        editorPath: this.options.editorPath,
        projectPath,
        requireBatchmode: true,
      });
    return new UnityTaskExecutor({
      adapter,
      projectPath,
      projectId: input.run.projectId,
      specVersionId: input.context.specVersionId,
      testSuites: gameplayTestSuites(input.context.gameSpec).map((suite) => {
        const item = (
          input.context.gameSpec ? developmentFor(input.context.gameSpec) : []
        ).find(
          (entry) => suite.testFilter === `GamerHub.Generated.${entry.id}Tests`,
        );
        const criteria = item ? developmentAcceptance(item) : undefined;
        return {
          ...suite,
          development: Boolean(item),
          ...(criteria ? { criteria } : {}),
        };
      }),
      ...(specArt(input.context.gameSpec) ? { resourceAssetPaths } : {}),
      rollbackAsset: async () => {
        for (const item of artSnapshot) {
          if (item.bytes) await writeFile(item.path, item.bytes);
          else
            await unlink(item.path).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
            });
        }
      },
      ...(this.options.durableStore
        ? {
            durableStore: this.options.durableStore,
            packageLockHash,
            templateVersion: `${profile.runtime}-2.0.0`,
          }
        : {}),
      ...(input.context.checkpointId
        ? { checkpointId: input.context.checkpointId }
        : {}),
      ...(input.context.checkpointRef
        ? { checkpointRef: input.context.checkpointRef }
        : {}),
      parameterValues: {
        jump_height: String(generatedConfig.jumpVelocity),
      },
      runPlaytest: async ({ task, runId }) => {
        const result = await adapter.runTests(
          {
            projectRef: projectPath,
            mode: 'playmode',
            testFilter: profile.testFilter,
          },
          {
            runId,
            taskId: task.id,
            workspaceRoot: projectPath,
            capabilities: ['test.playmode'],
          },
        );
        const passed =
          result.status === 'succeeded' &&
          result.failed === 0 &&
          result.passed >= profile.minimumPlaymodeTests;
        const contentHash = `sha256-${createHash('sha256')
          .update(JSON.stringify(result.output))
          .digest('hex')}`;
        return {
          passed,
          evidence: passed
            ? [
                {
                  type: 'playtest',
                  reference: `unity://playmode/${runId}/${task.id}`,
                  contentHash,
                },
              ]
            : [],
        };
      },
      evaluate: async ({ task, evidence }) => {
        const passed =
          evidence.length > 0 &&
          evidence.every(
            (item) =>
              item.type === 'playtest' &&
              item.reference.startsWith('unity://playmode/') &&
              Boolean(item.contentHash),
          );
        const contentHash = `sha256-${createHash('sha256')
          .update(JSON.stringify(evidence))
          .digest('hex')}`;
        const reportDirectory = join(
          projectPath,
          'Library',
          'GamerHub',
          'Evaluations',
        );
        await mkdir(reportDirectory, { recursive: true });
        const reportPath = join(
          reportDirectory,
          `${contentHash.slice('sha256-'.length)}.json`,
        );
        await writeFile(
          reportPath,
          `${JSON.stringify(
            {
              schemaVersion: '1.0.0',
              runId: input.run.id,
              taskId: task.id,
              specVersionId: input.context.specVersionId,
              evaluatorVersion: 'local-unity-evidence-gate-1.0.0',
              passed,
              evidence,
              contentHash,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        return {
          passed,
          evaluatorVersion: 'local-unity-evidence-gate-1.0.0',
          reportKey: reportPath,
          evidence: passed
            ? [
                {
                  type: 'evaluation',
                  reference: `unity://evaluation/${input.run.id}/${task.id}`,
                  contentHash,
                },
              ]
            : [],
        };
      },
    });
  }

  private async ensureWorkspace(projectPath: string): Promise<void> {
    const versionPath = join(
      projectPath,
      'ProjectSettings',
      'ProjectVersion.txt',
    );
    if (existsSync(versionPath)) return;
    if (existsSync(projectPath))
      throw new Error('LOCAL_UNITY_WORKSPACE_INVALID');
    await mkdir(this.options.workspaceRoot, { recursive: true });
    const staging = `${projectPath}.staging-${randomUUID()}`;
    await mkdir(staging, { recursive: false });
    for (const directory of projectDirectories)
      await cp(
        join(this.options.templatePath, directory),
        join(staging, directory),
        { recursive: true, errorOnExist: true },
      );
    await rename(staging, projectPath);
  }

  private async syncCuratedRuntime(projectPath: string): Promise<void> {
    await migrateTemplate(this.options.templatePath, projectPath);
  }
}

function contentType(path: string): string {
  const withoutEncoding = path.replace(/\.(br|gz)$/i, '');
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.wasm': 'application/wasm',
      '.json': 'application/json; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.data': 'application/octet-stream',
      '.symbols': 'application/octet-stream',
    }[extname(withoutEncoding).toLowerCase()] ?? 'application/octet-stream'
  );
}

export function registerRealUnityPreviewRoutes(
  server: FastifyInstance,
  manager: RealUnityLocalManager,
): void {
  server.get<{
    Params: { projectId: string; buildHash: string; '*': string };
  }>('/real-previews/:projectId/:buildHash/*', async (request, reply) => {
    let preview: RealUnityPreview | undefined;
    try {
      preview = await manager.preview(
        request.params.projectId,
        request.params.buildHash,
      );
    } catch {
      return reply.code(400).send({ code: 'PREVIEW_REFERENCE_INVALID' });
    }
    if (!preview) return reply.code(404).send({ code: 'PREVIEW_NOT_FOUND' });
    const requested = request.params['*'] || 'index.html';
    const filePath = resolve(preview.root, requested);
    const rootPrefix = `${resolve(preview.root)}${sep}`;
    if (filePath !== join(resolve(preview.root), 'index.html')) {
      if (!filePath.startsWith(rootPrefix))
        return reply.code(400).send({ code: 'PREVIEW_PATH_INVALID' });
    }
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      return reply.code(404).send({ code: 'PREVIEW_FILE_NOT_FOUND' });
    }
    if (!fileStat.isFile())
      return reply.code(404).send({ code: 'PREVIEW_FILE_NOT_FOUND' });
    reply
      // The preview iframe has an opaque sandbox origin. Its immutable public
      // assets must remain fetchable without granting access to application cookies.
      .header('access-control-allow-origin', '*')
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('x-gamerhub-provenance', 'real-unity-webgl')
      .header('x-gamerhub-trace-id', preview.traceId)
      .header('cross-origin-opener-policy', 'same-origin')
      .header('cross-origin-embedder-policy', 'require-corp')
      .header(
        'cache-control',
        requested === 'index.html'
          ? 'no-cache'
          : 'public, max-age=31536000, immutable',
      )
      .type(contentType(filePath));
    if (/\.gz$/i.test(filePath)) reply.header('content-encoding', 'gzip');
    if (/\.br$/i.test(filePath)) reply.header('content-encoding', 'br');
    return reply.send(createReadStream(filePath));
  });
}
