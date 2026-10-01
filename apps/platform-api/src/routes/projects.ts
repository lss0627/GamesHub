import type { ProjectService } from '../services/project-service';

export function createProjectRoutes(service: ProjectService) {
  return {
    create: (ownerId: string, name: string) => service.create(ownerId, name),
    list: (ownerId: string) => service.list(ownerId),
    get: (ownerId: string, projectId: string) =>
      service.get(ownerId, projectId),
  };
}
