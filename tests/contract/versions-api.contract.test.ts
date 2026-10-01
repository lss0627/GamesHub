import { RestoreService } from '@gamerhub/versioning';
import { describe, expect, it } from 'vitest';
import { createVersionRoutes } from '../../apps/platform-api/src/routes/versions';

describe('versions API contract', () => {
  it('lists versions and restores a valid checkpoint', async () => {
    const service = new RestoreService();
    const checkpoint = await service.create({
      projectId: 'project-1',
      specVersionId: 'spec-1',
      sourceRevision: 'rev-1',
      buildId: 'build-1',
      summary: 'baseline',
    });
    const routes = createVersionRoutes(service);
    expect((await routes.list('project-1')).items).toHaveLength(1);
    const restored = await routes.restore('project-1', checkpoint.id);
    expect(restored.status).toBe('restored');
  });
});
