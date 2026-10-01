import { RestoreService } from '@gamerhub/versioning';
import { describe, expect, it } from 'vitest';

describe('atomic checkpoint restore', () => {
  it('restores spec, source revision and build as one snapshot', async () => {
    const service = new RestoreService();
    const checkpoint = await service.create({
      projectId: 'project-1',
      specVersionId: 'spec-1',
      sourceRevision: 'rev-1',
      buildId: 'build-1',
      summary: 'before change',
    });
    const result = await service.restore('project-1', checkpoint.id);
    expect(result.specVersionId).toBe('spec-1');
    expect(result.sourceRevision).toBe('rev-1');
    expect(result.buildId).toBe('build-1');
  });
});
