import { InMemoryProjectRepository, type Project } from '@gamerhub/domain';

export class ProjectService {
  constructor(private readonly repository = new InMemoryProjectRepository()) {}

  create(ownerId: string, name: string): Project {
    const slug = `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'runner'
    }-${Date.now().toString(36)}`;
    return this.repository.createProject({
      ownerId,
      name,
      slug,
      quotaProfile: 'runner-standard',
    });
  }

  list(ownerId: string): Project[] {
    return this.repository.listProjects({ ownerId });
  }

  get(ownerId: string, projectId: string): Project {
    return this.repository.getProject(projectId, { ownerId });
  }
}
