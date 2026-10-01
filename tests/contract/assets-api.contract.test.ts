import { AssetRepository, createAssetRoutes } from '@gamerhub/assets';
import { describe, expect, it } from 'vitest';
import { createHttpServer } from '../../apps/platform-api/src/server';

describe('assets API contract', () => {
  it('finalizes a content-addressed upload and lists logical usage', async () => {
    const repository = new AssetRepository();
    const routes = createAssetRoutes(repository);
    const asset = await routes.upload({
      projectId: 'project-1',
      createdByRunId: 'run-1',
      name: 'cat.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
      license: { kind: 'user_owned', text: 'I own this asset' },
    });
    expect(asset.contentHash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect((await routes.list('project-1')).items).toHaveLength(1);
  });

  it('commits Unity import only after compile and playtest, with durable usage', async () => {
    const repository = new AssetRepository();
    const asset = await repository.upload({
      projectId: 'project-1',
      createdByRunId: 'run-1',
      name: 'cat.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
      license: { kind: 'user_owned', text: 'I own this asset' },
    });
    const calls: string[] = [];

    const result = await repository.importAsset(
      {
        projectId: 'project-1',
        assetId: asset.id,
        targetPath: 'Assets/Game/Art/Player.png',
        specVersionId: 'spec-1',
        logicalEntityId: 'player',
        usageKind: 'player',
      },
      {
        importAsset: async () => {
          calls.push('import');
          return { unityAssetGuid: 'guid-player' };
        },
        compile: async () => {
          calls.push('compile');
          return true;
        },
        playtest: async () => {
          calls.push('playtest');
          return true;
        },
        rollback: async () => {
          calls.push('rollback');
        },
      },
    );

    expect(result.status).toBe('imported');
    expect(result.rollbackPerformed).toBe(false);
    expect(calls).toEqual(['import', 'compile', 'playtest']);
    expect((await repository.list('project-1'))[0]?.importStatus).toBe(
      'imported',
    );
    expect(await repository.listUsage('project-1')).toEqual([
      {
        assetId: asset.id,
        projectId: 'project-1',
        logicalEntityId: 'player',
        relativePath: 'Assets/Game/Art/Player.png',
        usageKind: 'player',
        unityAssetGuid: 'guid-player',
        introducedSpecVersionId: 'spec-1',
      },
    ]);
  });

  it('marks a failed import and invokes rollback when Playtest rejects the asset', async () => {
    const repository = new AssetRepository();
    const asset = await repository.upload({
      projectId: 'project-1',
      createdByRunId: 'run-1',
      name: 'cat.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
      license: { kind: 'user_owned', text: 'I own this asset' },
    });
    let rollbackCount = 0;

    const result = await repository.importAsset(
      {
        projectId: 'project-1',
        assetId: asset.id,
        targetPath: 'Assets/Game/Art/Player.png',
      },
      {
        importAsset: async () => undefined,
        compile: async () => true,
        playtest: async () => false,
        rollback: async () => {
          rollbackCount += 1;
        },
      },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('PLAYTEST_FAILED');
    expect(result.rollbackPerformed).toBe(true);
    expect(rollbackCount).toBe(1);
    expect((await repository.list('project-1'))[0]?.importStatus).toBe(
      'failed',
    );
  });

  it('mounts a creator-safe replacement route that queues a modify run', async () => {
    const assetRepository = new AssetRepository();
    const server = createHttpServer(
      { userId: 'user-1', role: 'creator' },
      { assetRepository },
    );
    try {
      const project = await server.inject({
        method: 'POST',
        url: '/v1/projects',
        payload: { name: 'Asset route' },
      });
      expect(project.statusCode).toBe(201);
      const projectId = (project.json() as { id: string }).id;
      const uploaded = await server.inject({
        method: 'POST',
        url: `/v1/projects/${projectId}/assets`,
        payload: {
          name: 'cat.png',
          mime_type: 'image/png',
          bytes_base64: Buffer.from([137, 80, 78, 71]).toString('base64'),
          license_text: 'I own this asset',
        },
      });
      expect(uploaded.statusCode).toBe(201);
      const assetId = (uploaded.json() as { id: string }).id;
      const content = await server.inject({
        method: 'GET',
        url: `/v1/projects/${projectId}/assets/${assetId}/content`,
      });
      expect(content.statusCode).toBe(200);
      expect(content.headers['content-type']).toBe('image/png');
      expect(content.rawPayload).toEqual(Buffer.from([137, 80, 78, 71]));
      const other = await server.inject({
        method: 'POST',
        url: '/v1/projects',
        payload: { name: 'Other project' },
      });
      const foreign = await server.inject({
        method: 'GET',
        url: `/v1/projects/${other.json().id}/assets/${assetId}/content`,
      });
      expect(foreign.statusCode).toBe(404);
      const replacement = await server.inject({
        method: 'POST',
        url: `/v1/projects/${projectId}/assets/${assetId}/replace`,
        headers: { 'Idempotency-Key': 'asset-replace-1' },
      });
      expect(replacement.statusCode).toBe(202);
      expect(replacement.json()).toMatchObject({ request_type: 'modify' });
    } finally {
      await server.close();
    }
  });
});
