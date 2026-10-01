import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryPlatformStore } from '@gamerhub/domain';
import { GameSpecService, runnerGameSpec } from '@gamerhub/game-spec';
import { InMemoryCheckpointService } from '@gamerhub/versioning';
import { describe, expect, it } from 'vitest';
import {
  LocalJsonGameSpecPersistence,
  LocalJsonPlatformStore,
} from '../../apps/local-dev/src/local-persistence';
import { LocalGameSpecVersionService } from '../../apps/local-dev/src/local-version-service';
import {
  RealUnityLocalManager,
  runnerConfigFromSpec,
} from '../../apps/local-dev/src/real-unity';
import {
  createLocalSupportServer,
  createLocalTaskExecutor,
  localDataMode,
  localExecutionMode,
} from '../../apps/local-dev/src/server';
import { OrchestratorWorker } from '../../apps/orchestrator-worker/src/worker';

describe('local development runtime', () => {
  it('maps the DeepSeek Game Spec into the generated Unity runtime config', () => {
    const spec = structuredClone(runnerGameSpec);
    spec.game.name = 'Neon Cat Runner';
    spec.player.movement.speed = 9;
    spec.player.movement.jump_height = 5.5;
    const coinSystem = spec.systems.find(
      (system) => system.system_id === 'coin_collection',
    );
    if (coinSystem) coinSystem.config.score_per_coin = 25;

    expect(runnerConfigFromSpec(spec, 'spec-real-1')).toMatchObject({
      gameName: 'Neon Cat Runner',
      playerSpeed: 9,
      jumpVelocity: 5.5,
      scorePerCoin: 25,
      specVersionId: 'spec-real-1',
    });
  });

  it('requires an explicit known local execution mode', () => {
    expect(localExecutionMode(undefined)).toBe('fixture');
    expect(localExecutionMode('real-unity')).toBe('real-unity');
    expect(() => localExecutionMode('auto-fallback')).toThrow(
      'LOCAL_EXECUTION_MODE_INVALID',
    );
  });

  it('keeps durable local data selection explicit and fail-closed', () => {
    expect(localDataMode('memory', 'fixture')).toBe('memory');
    expect(localDataMode('json', 'real-unity')).toBe('json');
    expect(localDataMode('postgres-redis', 'real-unity')).toBe(
      'postgres-redis',
    );
    expect(() => localDataMode('redis-only', 'real-unity')).toThrow(
      'LOCAL_DATA_MODE_INVALID',
    );
  });

  it('serves only a verified real Unity WebGL artifact as a real preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gamerhub-real-unity-'));
    try {
      const editorPath = join(root, 'Unity.exe');
      const templatePath = join(root, 'template');
      const workspaceRoot = join(root, 'workspaces');
      await writeFile(editorPath, 'test executable placeholder');
      await mkdir(join(templatePath, 'ProjectSettings'), { recursive: true });
      await writeFile(
        join(templatePath, 'ProjectSettings', 'ProjectVersion.txt'),
        'm_EditorVersion: 6000.0.80f1',
      );
      const manager = new RealUnityLocalManager({
        editorPath,
        templatePath,
        workspaceRoot,
        publicOrigin: 'http://127.0.0.1:3010',
        browserInspector: async (input) => ({
          passed: true,
          buildHash: input.buildHash,
          runId: input.runId,
          specVersionId: input.specVersionId,
          checks: [],
          reportHash: `sha256-${'f'.repeat(64)}`,
        }),
      });
      const buildRoot = join(
        workspaceRoot,
        'project-real',
        'Builds',
        'Web',
        'run-real',
      );
      await mkdir(buildRoot, { recursive: true });
      await writeFile(join(buildRoot, 'index.html'), '<canvas></canvas>');
      const resources = join(workspaceRoot, 'project-real', 'Assets/Resources');
      await mkdir(resources, { recursive: true });
      await writeFile(
        join(resources, 'GamerHubGameConfig.json'),
        JSON.stringify({ specVersionId: 'spec-real' }),
      );
      const publication = await manager.publish({
        projectId: 'project-real',
        runId: 'run-real',
        buildHash: 'workflow-aggregate-hash',
      });
      expect(publication.buildHash).toMatch(/^sha256-/);
      expect(publication.evidence[0]?.reference).toBe(
        'unity-webgl://project-real/run-real',
      );
      const restartedManager = new RealUnityLocalManager({
        editorPath,
        templatePath,
        workspaceRoot,
        publicOrigin: 'http://127.0.0.1:3010',
      });
      const server = createLocalSupportServer('http://127.0.0.1:3010', {
        executionMode: 'real-unity',
        realUnityManager: restartedManager,
      });
      const health = await server.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.headers['x-gamerhub-provenance']).toBe(
        'real-unity-local-dev',
      );
      const response = await server.inject({
        method: 'GET',
        url: new URL(publication.url).pathname,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-gamerhub-provenance']).toBe(
        'real-unity-webgl',
      );
      expect(response.body).toContain('<canvas>');
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['cross-origin-resource-policy']).toBe(
        'cross-origin',
      );
      await server.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores projects, runs, events and active Game Specs after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gamerhub-local-store-'));
    try {
      const platformPath = join(root, 'platform.json');
      const specsPath = join(root, 'game-specs.json');
      const store = await LocalJsonPlatformStore.open(platformPath);
      const project = await store.createProject({
        ownerId: 'local-user',
        name: 'Persistent Runner',
        slug: 'persistent-runner',
        quotaProfile: 'runner-standard',
      });
      const { run } = await store.createRun({
        ownerId: 'local-user',
        projectId: project.id,
        requestType: 'create',
        userInput: 'create a persistent runner',
        idempotencyKey: 'persistent-run-1',
      });
      const specService = new GameSpecService(
        await LocalJsonGameSpecPersistence.open(specsPath),
      );
      const version = await specService.createVersionAndPersist({
        projectId: project.id,
        sourceRunId: run.id,
        spec: runnerGameSpec,
        summary: 'persist the runner spec',
      });
      await specService.activateAndPersist(version.id);

      const restoredStore = await LocalJsonPlatformStore.open(platformPath);
      const restoredRun = await restoredStore.getRun(project.id, run.id, {
        ownerId: 'local-user',
      });
      const restoredEvents = await restoredStore.replayEvents(run.id, 0);
      const restoredSpecService = new GameSpecService(
        await LocalJsonGameSpecPersistence.open(specsPath),
      );
      const restoredVersions = await restoredSpecService.listDurably(
        project.id,
      );

      expect(restoredRun.status).toBe('queued');
      expect(restoredEvents[0]?.eventType).toBe('run.accepted');
      expect(restoredVersions).toEqual([
        expect.objectContaining({ id: version.id, status: 'active' }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('queues an exact rollback and validates it through the worker before activation', async () => {
    const store = new InMemoryPlatformStore();
    const project = await store.createProject({
      ownerId: 'local-user',
      name: 'Rollback Runner',
      slug: 'rollback-runner',
      quotaProfile: 'runner-standard',
    });
    const specs = new GameSpecService();
    const baselineSpec = structuredClone(runnerGameSpec);
    baselineSpec.player.movement.speed = 5;
    const baseline = await specs.createVersionAndPersist({
      projectId: project.id,
      sourceRunId: 'create-run',
      spec: baselineSpec,
      summary: '初始速度 5',
    });
    await specs.activateAndPersist(baseline.id);
    const currentSpec = structuredClone(baselineSpec);
    currentSpec.player.movement.speed = 9;
    const current = await specs.createVersionAndPersist({
      projectId: project.id,
      sourceRunId: 'modify-run',
      spec: currentSpec,
      summary: '速度提高到 9',
      changeType: 'modify',
      parentVersionId: baseline.id,
    });
    await specs.activateAndPersist(current.id);

    const versions = new LocalGameSpecVersionService(store, specs);
    expect(await versions.list(project.id)).toEqual([
      expect.objectContaining({ id: baseline.id, status: 'superseded' }),
      expect.objectContaining({ id: current.id, status: 'active' }),
    ]);
    const queued = (await versions.restore(project.id, baseline.id)) as {
      id: string;
      request_type: string;
      status: string;
    };
    expect(queued).toMatchObject({
      request_type: 'rollback',
      status: 'queued',
    });

    const worker = new OrchestratorWorker({
      store,
      specService: specs,
      checkpointService: new InMemoryCheckpointService(),
      sourceRevision: async () => 'revision-before-rollback',
      interpretPrompt: () => {
        throw new Error('MODEL_SHOULD_NOT_BE_CALLED_FOR_ROLLBACK');
      },
      taskExecutor: createLocalTaskExecutor(),
      publishPreview: async ({ projectId, buildHash }) => ({
        healthy: true,
        url: `http://127.0.0.1:3010/previews/${projectId}/${buildHash}/index.html`,
        buildHash,
        evidence: [
          {
            type: 'preview',
            reference: `fixture://rollback/${buildHash}`,
          },
        ],
      }),
    });
    const [result] = await worker.runUntilIdle(1);
    expect(result?.status).toBe('succeeded');
    const active = specs
      .list(project.id)
      .filter((version) => version.status === 'active')
      .at(-1);
    expect(active).toMatchObject({
      changeType: 'rollback',
      parentVersionId: current.id,
      spec: { player: { movement: { speed: 5 } } },
    });
  });

  it('serves explicitly marked fixture support protocols', async () => {
    const server = createLocalSupportServer();
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const scan = await server.inject({
      method: 'POST',
      url: '/scan',
      payload: { bytes_base64: png },
    });
    expect(scan.statusCode).toBe(200);
    expect(scan.headers['x-gamerhub-provenance']).toBe('fixture-local-dev');
    expect(scan.json()).toMatchObject({ clean: true });

    const decode = await server.inject({
      method: 'POST',
      url: '/decode',
      payload: { mime_type: 'image/png', bytes_base64: png },
    });
    expect(decode.statusCode).toBe(200);
    expect(decode.json()).toMatchObject({
      mime_type: 'image/png',
      width: 1,
      height: 1,
      provenance: 'fixture-passthrough-not-production-reencode',
    });
  });

  it('completes the local prompt workflow without claiming release evidence', async () => {
    const store = new InMemoryPlatformStore();
    const project = await store.createProject({
      ownerId: 'local-user',
      name: 'Local Runner',
      slug: 'local-runner',
      quotaProfile: 'runner-standard',
    });
    const { run } = await store.createRun({
      ownerId: 'local-user',
      projectId: project.id,
      requestType: 'create',
      userInput: '做一个可以跳跃和收集金币的猫咪跑酷游戏',
      idempotencyKey: 'local-dev-test',
      sessionId: 'local-session',
    });
    const worker = new OrchestratorWorker({
      store,
      taskExecutor: createLocalTaskExecutor(),
      publishPreview: async ({ buildHash, projectId }) => ({
        healthy: true,
        url: `http://127.0.0.1:3010/previews/${projectId}/${buildHash}/index.html`,
        buildHash,
        evidence: [
          {
            type: 'preview',
            reference: `fixture://local-dev/preview/${buildHash}`,
          },
        ],
      }),
    });
    const [result] = await worker.runUntilIdle();
    expect(result?.status).toBe('succeeded');
    expect(result?.previewUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:3010\/previews\//,
    );
    const evidence = await store.replayEvents(run.id, 0);
    expect(evidence.some((event) => event.eventType === 'run.succeeded')).toBe(
      true,
    );
    const agentActs = evidence.filter(
      (event) => event.eventType === 'agent.act.started',
    );
    expect(agentActs[0]?.payload.toolName).toBe('model.game-spec.interpret');
    expect(
      agentActs.some(
        (event) => event.payload.toolName === 'unity.task.execute',
      ),
    ).toBe(true);
    expect(
      evidence.some((event) => event.eventType === 'agent.run.completed'),
    ).toBe(true);
  });
});
