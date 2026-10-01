import { randomUUID } from 'node:crypto';

export interface Checkpoint {
  id: string;
  projectId: string;
  specVersionId: string;
  sourceRunId: string;
  parentCheckpointId?: string;
  commitRef: string;
  summary: string;
  changeManifest: Record<string, unknown>;
  status: 'creating' | 'valid' | 'invalid' | 'restored';
  createdAt: string;
}
export interface CheckpointService {
  create(
    input: Omit<Checkpoint, 'id' | 'status' | 'createdAt'>,
  ): Promise<Checkpoint>;
  get(id: string, projectId: string): Promise<Checkpoint>;
  list(projectId: string): Promise<Checkpoint[]>;
  restore(
    id: string,
    projectId: string,
    expectedVersion?: number,
  ): Promise<Checkpoint>;
}
export class InMemoryCheckpointService implements CheckpointService {
  private readonly checkpoints = new Map<string, Checkpoint>();
  async create(
    input: Omit<Checkpoint, 'id' | 'status' | 'createdAt'>,
  ): Promise<Checkpoint> {
    const checkpoint = {
      ...input,
      id: randomUUID(),
      status: 'valid' as const,
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return { ...checkpoint };
  }
  async get(id: string, projectId: string) {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw new Error('CHECKPOINT_NOT_FOUND');
    return { ...checkpoint };
  }
  async list(projectId: string) {
    return [...this.checkpoints.values()]
      .filter((item) => item.projectId === projectId)
      .map((item) => ({ ...item }));
  }
  async restore(id: string, projectId: string) {
    const checkpoint = await this.get(id, projectId);
    if (checkpoint.status !== 'valid' && checkpoint.status !== 'restored')
      throw new Error('CHECKPOINT_INVALID');
    checkpoint.status = 'restored';
    this.checkpoints.set(id, checkpoint);
    return { ...checkpoint };
  }
}

export * from './checkpoint-service';
export * from './git-checkpoint-store';
export * from './metadata-checkpoint-service';
export * from './restore-service';
