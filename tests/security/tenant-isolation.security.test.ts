import {
  InMemoryProjectRepository,
  RepositoryNotFoundError,
} from '@gamerhub/domain';
import { describe, expect, it } from 'vitest';

describe('tenant isolation', () => {
  it('does not return another owner project through repository reads', () => {
    const repository = new InMemoryProjectRepository();
    const project = repository.createProject({
      ownerId: 'owner-a',
      name: 'A',
      slug: 'a',
      quotaProfile: 'runner',
    });
    expect(() =>
      repository.getProject(project.id, { ownerId: 'owner-b' }),
    ).toThrow(RepositoryNotFoundError);
    expect(repository.listProjects({ ownerId: 'owner-b' })).toHaveLength(0);
  });
});
