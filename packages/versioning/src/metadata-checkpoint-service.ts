import { randomUUID } from 'node:crypto';
import type { CheckpointMetadataStore } from './git-checkpoint-store';
import type { Checkpoint, CheckpointService } from './index';

/**
 * Persists checkpoint provenance without assuming that the workspace itself is
 * a Git repository. The supplied commitRef remains the immutable source
 * revision, while the metadata store owns durable lookup and restore status.
 */
export class MetadataCheckpointService implements CheckpointService {
  constructor(private readonly metadata: CheckpointMetadataStore) {}

  async create(
    input: Omit<Checkpoint, 'id' | 'status' | 'createdAt'>,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      ...input,
      id: randomUUID(),
      status: 'valid',
      createdAt: new Date().toISOString(),
    };
    await this.metadata.save(checkpoint);
    return structuredClone(checkpoint);
  }

  get(id: string, projectId: string): Promise<Checkpoint> {
    return this.metadata.get(id, projectId);
  }

  list(projectId: string): Promise<Checkpoint[]> {
    return this.metadata.list(projectId);
  }

  restore(id: string, projectId: string): Promise<Checkpoint> {
    return this.metadata.markRestored(id, projectId);
  }
}
