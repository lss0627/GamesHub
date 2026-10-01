import { createHash, randomUUID } from 'node:crypto';

export interface PreMutationCheckpoint {
  id: string;
  projectId: string;
  runId: string;
  expectedRevision: string;
  commitRef: string;
  changeManifest: Record<string, unknown>;
  status: 'valid' | 'restored' | 'invalid';
  createdAt: string;
}

export class PreMutationCheckpointService {
  private readonly checkpoints = new Map<string, PreMutationCheckpoint>();

  create(
    input: Omit<
      PreMutationCheckpoint,
      'id' | 'commitRef' | 'status' | 'createdAt'
    >,
  ): PreMutationCheckpoint {
    const checkpoint = {
      ...input,
      id: randomUUID(),
      commitRef: `checkpoint-${createHash('sha1').update(`${input.projectId}:${input.runId}:${input.expectedRevision}`).digest('hex').slice(0, 12)}`,
      status: 'valid' as const,
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return structuredClone(checkpoint);
  }

  assertExpectedRevision(checkpointId: string, revision: string): void {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw new Error('CHECKPOINT_NOT_FOUND');
    if (checkpoint.expectedRevision !== revision)
      throw new Error('REVISION_CONFLICT');
    if (checkpoint.status === 'invalid') throw new Error('CHECKPOINT_INVALID');
  }

  restore(checkpointId: string): PreMutationCheckpoint {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.status === 'invalid')
      throw new Error('CHECKPOINT_INVALID');
    checkpoint.status = 'restored';
    return structuredClone(checkpoint);
  }
}
