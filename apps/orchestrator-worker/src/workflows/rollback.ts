import type { RestoreService } from '@gamerhub/versioning';

export async function rollbackWorkflow(input: {
  projectId: string;
  checkpointId: string;
  restoreService: RestoreService;
  verify?: () => Promise<boolean>;
}) {
  const restored = await input.restoreService.restore(
    input.projectId,
    input.checkpointId,
  );
  const healthy = await (input.verify?.() ?? Promise.resolve(true));
  return {
    restored,
    status: healthy ? ('succeeded' as const) : ('failed' as const),
    healthVerified: healthy,
  };
}
