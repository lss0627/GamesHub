import { InMemoryCheckpointService } from '@gamerhub/versioning';
import { expect, it } from 'vitest';
import { SourceCheckpointService } from '../../apps/local-dev/src/source-checkpoints';

it('applies checkpoint source before marking metadata restored and preserves failure state', async () => {
  const metadata = new InMemoryCheckpointService();
  const checkpoint = await metadata.create({
    projectId: 'project',
    specVersionId: 'spec',
    sourceRunId: 'run',
    commitRef: 'source-original',
    summary: 'before edit',
    changeManifest: {},
  });
  const revisions: string[] = [];
  const service = new SourceCheckpointService(
    metadata,
    async (projectId, revision) => {
      expect(projectId).toBe('project');
      expect((await metadata.get(checkpoint.id, projectId)).status).toBe(
        'valid',
      );
      revisions.push(revision);
      throw new Error('SOURCE_SNAPSHOT_CORRUPT');
    },
  );
  await expect(service.restore(checkpoint.id, 'project')).rejects.toThrow(
    'SOURCE_SNAPSHOT_CORRUPT',
  );
  expect((await metadata.get(checkpoint.id, 'project')).status).toBe('valid');
  const healthy = new SourceCheckpointService(
    metadata,
    async (_projectId, revision) => {
      revisions.push(revision);
    },
  );
  expect((await healthy.restore(checkpoint.id, 'project')).status).toBe(
    'restored',
  );
  expect(revisions).toEqual(['source-original', 'source-original']);
});
