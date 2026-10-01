import { randomUUID } from 'node:crypto';
import type { Checkpoint, CheckpointService } from './index';

export interface RestoreCheckpoint {
  id: string;
  projectId: string;
  specVersionId: string;
  sourceRevision: string;
  buildId: string;
  summary: string;
  status: 'valid' | 'restored' | 'invalid';
  createdAt: string;
}

export interface RestoredProjectState {
  specVersionId: string | undefined;
  sourceRevision: string | undefined;
  buildId: string | undefined;
}

export class RestoreService {
  private readonly checkpoints = new Map<string, RestoreCheckpoint>();
  private readonly states = new Map<string, RestoredProjectState>();

  async create(
    input: Omit<RestoreCheckpoint, 'id' | 'status' | 'createdAt'>,
  ): Promise<RestoreCheckpoint> {
    const checkpoint = {
      ...input,
      id: randomUUID(),
      status: 'valid' as const,
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    if (!this.states.has(input.projectId))
      this.states.set(input.projectId, {
        specVersionId: undefined,
        sourceRevision: undefined,
        buildId: undefined,
      });
    return structuredClone(checkpoint);
  }

  async list(projectId: string): Promise<RestoreCheckpoint[]> {
    return [...this.checkpoints.values()]
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .map((checkpoint) => structuredClone(checkpoint));
  }

  async restore(
    projectId: string,
    checkpointId: string,
  ): Promise<RestoreCheckpoint & RestoredProjectState> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw Object.assign(new Error('CHECKPOINT_NOT_FOUND'), {
        code: 'CHECKPOINT_NOT_FOUND',
      });
    if (checkpoint.status !== 'valid' && checkpoint.status !== 'restored')
      throw Object.assign(new Error('CHECKPOINT_INVALID'), {
        code: 'CHECKPOINT_INVALID',
      });
    const nextState = {
      specVersionId: checkpoint.specVersionId,
      sourceRevision: checkpoint.sourceRevision,
      buildId: checkpoint.buildId,
    };
    this.states.set(projectId, nextState);
    checkpoint.status = 'restored';
    return { ...structuredClone(checkpoint), ...nextState };
  }

  invalidate(checkpointId: string): void {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw new Error('CHECKPOINT_NOT_FOUND');
    checkpoint.status = 'invalid';
  }

  current(projectId: string): RestoredProjectState {
    return structuredClone(
      this.states.get(projectId) ?? {
        specVersionId: undefined,
        sourceRevision: undefined,
        buildId: undefined,
      },
    );
  }
}

export interface AtomicRestoreAdapters {
  source: CheckpointService;
  restoreGameSpec: (specVersionId: string, projectId?: string) => Promise<void>;
  restoreBuild: (buildId: string, projectId?: string) => Promise<void>;
}

export interface AtomicRestoreResult {
  checkpointId: string;
  projectId: string;
  sourceRestored: boolean;
  specRestored: boolean;
  buildRestored: boolean;
  committed: boolean;
}

/** Coordinates the source reset and immutable spec/build pointers. */
export class AtomicGitRestoreService {
  constructor(private readonly adapters: AtomicRestoreAdapters) {}

  async restore(
    projectId: string,
    checkpointId: string,
  ): Promise<AtomicRestoreResult> {
    const checkpoint = await this.adapters.source.get(checkpointId, projectId);
    if (checkpoint.status !== 'valid' && checkpoint.status !== 'restored')
      throw new Error('CHECKPOINT_INVALID');
    const source = await this.adapters.source.restore(checkpointId, projectId);
    let specRestored = false;
    let buildRestored = false;
    try {
      await this.adapters.restoreGameSpec(
        source.specVersionId,
        source.projectId,
      );
      specRestored = true;
      const buildId = source.changeManifest.buildId;
      if (typeof buildId !== 'string' || !buildId.trim())
        throw new Error('RESTORE_BUILD_POINTER_MISSING');
      await this.adapters.restoreBuild(buildId, source.projectId);
      buildRestored = true;
    } catch (error) {
      // The source checkpoint is immutable and remains the only safe state to
      // retry from. Do not report a committed restore when a pointer failed.
      throw Object.assign(
        error instanceof Error ? error : new Error('RESTORE_POINTER_FAILED'),
        {
          code: 'ATOMIC_RESTORE_FAILED',
          sourceRestored: true,
          specRestored,
          buildRestored,
        },
      );
    }
    return {
      checkpointId,
      projectId,
      sourceRestored: true,
      specRestored,
      buildRestored,
      committed: true,
    };
  }
}

/** Version API facade over durable Git checkpoints and atomic pointer restore. */
export class GitVersionRestoreService {
  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly atomic: AtomicGitRestoreService,
  ) {}

  list(projectId: string): Promise<Checkpoint[]> {
    return this.checkpoints.list(projectId);
  }

  async restore(
    projectId: string,
    checkpointId: string,
  ): Promise<AtomicRestoreResult & { checkpoint: Checkpoint }> {
    const result = await this.atomic.restore(projectId, checkpointId);
    return {
      ...result,
      checkpoint: await this.checkpoints.get(checkpointId, projectId),
    };
  }
}
