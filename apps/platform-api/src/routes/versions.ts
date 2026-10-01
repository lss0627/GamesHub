export interface VersionRestoreService {
  list(projectId: string): Promise<unknown[]>;
  restore(
    projectId: string,
    checkpointId: string,
    idempotencyKey?: string,
  ): Promise<unknown>;
}

export function createVersionRoutes(service: VersionRestoreService) {
  return {
    list: async (projectId: string) => ({
      items: await service.list(projectId),
    }),
    restore: (projectId: string, checkpointId: string) =>
      service.restore(projectId, checkpointId),
  };
}
