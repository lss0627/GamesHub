import {
  type Checkpoint,
  type CheckpointMetadataStore,
  MetadataCheckpointService,
} from '@gamerhub/versioning';
import { describe, expect, it } from 'vitest';

class MemoryMetadataStore implements CheckpointMetadataStore {
  private readonly values = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.values.set(checkpoint.id, structuredClone(checkpoint));
  }

  async get(id: string, projectId: string): Promise<Checkpoint> {
    const checkpoint = this.values.get(id);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw new Error('CHECKPOINT_NOT_FOUND');
    return structuredClone(checkpoint);
  }

  async list(projectId: string): Promise<Checkpoint[]> {
    return [...this.values.values()]
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .map((checkpoint) => structuredClone(checkpoint));
  }

  async markRestored(id: string, projectId: string): Promise<Checkpoint> {
    const checkpoint = await this.get(id, projectId);
    const restored = { ...checkpoint, status: 'restored' as const };
    this.values.set(id, restored);
    return structuredClone(restored);
  }
}

describe('MetadataCheckpointService', () => {
  it('durably records and restores non-Git workspace provenance', async () => {
    const service = new MetadataCheckpointService(new MemoryMetadataStore());
    const checkpoint = await service.create({
      projectId: 'project-1',
      specVersionId: 'spec-1',
      sourceRunId: 'run-1',
      commitRef: 'sha256-source',
      summary: 'Pre-mutation checkpoint',
      changeManifest: { paths: ['Assets/Resources/GameConfig.json'] },
    });

    expect((await service.get(checkpoint.id, 'project-1')).commitRef).toBe(
      'sha256-source',
    );
    expect(await service.list('project-1')).toHaveLength(1);
    expect((await service.restore(checkpoint.id, 'project-1')).status).toBe(
      'restored',
    );
  });
});
