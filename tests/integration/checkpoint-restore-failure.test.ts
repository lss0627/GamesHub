import { RestoreService } from '@gamerhub/versioning';
import { describe, expect, it } from 'vitest';

describe('invalid checkpoint restore', () => {
  it('preserves current state when restore validation fails', async () => {
    const service = new RestoreService();
    const checkpoint = await service.create({
      projectId: 'project-1',
      specVersionId: 'spec-1',
      sourceRevision: 'rev-1',
      buildId: 'build-1',
      summary: 'baseline',
    });
    service.invalidate(checkpoint.id);
    await expect(
      service.restore('project-1', checkpoint.id),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(service.current('project-1')).toEqual({
      specVersionId: undefined,
      sourceRevision: undefined,
      buildId: undefined,
    });
  });
});
