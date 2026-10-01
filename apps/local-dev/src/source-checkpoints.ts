import type { CheckpointService } from '@gamerhub/versioning';

/** Mark restore complete only after the immutable source snapshot is applied. */
export class SourceCheckpointService implements CheckpointService {
  constructor(
    private readonly metadata: CheckpointService,
    private readonly restoreSource: (
      projectId: string,
      revision: string,
    ) => Promise<void>,
  ) {}
  create(input: Parameters<CheckpointService['create']>[0]) {
    return this.metadata.create(input);
  }
  get(id: string, projectId: string) {
    return this.metadata.get(id, projectId);
  }
  list(projectId: string) {
    return this.metadata.list(projectId);
  }
  async restore(id: string, projectId: string, expectedVersion?: number) {
    const checkpoint = await this.metadata.get(id, projectId);
    if (checkpoint.status !== 'valid' && checkpoint.status !== 'restored')
      throw new Error('CHECKPOINT_INVALID');
    await this.restoreSource(projectId, checkpoint.commitRef);
    return this.metadata.restore(id, projectId, expectedVersion);
  }
}
