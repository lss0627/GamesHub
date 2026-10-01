import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Checkpoint, CheckpointService } from './index';

export interface GitCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

export interface CheckpointMetadataStore {
  save(checkpoint: Checkpoint): Promise<void>;
  get(id: string, projectId: string): Promise<Checkpoint>;
  list(projectId: string): Promise<Checkpoint[]>;
  markRestored(id: string, projectId: string): Promise<Checkpoint>;
}

export interface CheckpointSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export type CheckpointTenantTransaction = <T>(
  ownerId: string,
  operation: (client: CheckpointSqlExecutor) => Promise<T>,
) => Promise<T>;

function checkpointFromRow(row: Record<string, unknown>): Checkpoint {
  const value = (item: unknown): string =>
    item instanceof Date ? item.toISOString() : String(item);
  return {
    id: value(row.id),
    projectId: value(row.project_id),
    specVersionId: value(row.game_spec_version_id),
    sourceRunId: value(row.source_run_id),
    ...(row.parent_checkpoint_id
      ? { parentCheckpointId: value(row.parent_checkpoint_id) }
      : {}),
    commitRef: value(row.commit_ref),
    summary: value(row.summary),
    changeManifest:
      row.change_manifest && typeof row.change_manifest === 'object'
        ? (row.change_manifest as Record<string, unknown>)
        : {},
    status: row.status as Checkpoint['status'],
    createdAt: value(row.created_at),
  };
}

/** Durable checkpoint metadata adapter. Git remains the source-of-truth for files. */
export class PostgresCheckpointMetadataStore
  implements CheckpointMetadataStore
{
  constructor(
    private readonly db: CheckpointSqlExecutor,
    private readonly options: {
      ownerId?: string;
      tenantTransaction?: CheckpointTenantTransaction;
    } = {},
  ) {}

  private scoped<T>(
    operation: (db: CheckpointSqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.options.ownerId && this.options.tenantTransaction
      ? this.options.tenantTransaction(this.options.ownerId, operation)
      : operation(this.db);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    await this.scoped((db) =>
      db
        .query(
          `INSERT INTO checkpoints
            (id, project_id, game_spec_version_id, source_run_id, parent_checkpoint_id,
             commit_ref, summary, change_manifest, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            checkpoint.id,
            checkpoint.projectId,
            checkpoint.specVersionId,
            checkpoint.sourceRunId,
            checkpoint.parentCheckpointId ?? null,
            checkpoint.commitRef,
            checkpoint.summary,
            JSON.stringify(checkpoint.changeManifest),
            checkpoint.status,
            checkpoint.createdAt,
          ],
        )
        .then(() => undefined),
    );
  }

  async get(id: string, projectId: string): Promise<Checkpoint> {
    return this.scoped(async (db) => {
      const result = await db.query(
        'SELECT * FROM checkpoints WHERE id = $1 AND project_id = $2',
        [id, projectId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('CHECKPOINT_NOT_FOUND');
      return checkpointFromRow(row);
    });
  }

  async list(projectId: string): Promise<Checkpoint[]> {
    return this.scoped(async (db) => {
      const result = await db.query(
        'SELECT * FROM checkpoints WHERE project_id = $1 ORDER BY created_at, id',
        [projectId],
      );
      return result.rows.map(checkpointFromRow);
    });
  }

  async markRestored(id: string, projectId: string): Promise<Checkpoint> {
    return this.scoped(async (db) => {
      const result = await db.query(
        `UPDATE checkpoints SET status = 'restored'
         WHERE id = $1 AND project_id = $2
         RETURNING *`,
        [id, projectId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('CHECKPOINT_NOT_FOUND');
      return checkpointFromRow(row);
    });
  }
}

function spawnGit(gitPath: string): GitCommandRunner {
  return (args, cwd) =>
    new Promise((resolveResult) => {
      const child = spawn(gitPath, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) =>
        resolveResult({
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${error.message}`,
        }),
      );
      child.on('close', (exitCode) =>
        resolveResult({ exitCode, stdout, stderr }),
      );
    });
}

function assertRepoPath(repoPath: string): string {
  if (
    !repoPath ||
    !isAbsolute(repoPath) ||
    !existsSync(repoPath) ||
    !statSync(repoPath).isDirectory()
  )
    throw new Error('GIT_REPOSITORY_INVALID');
  return resolve(repoPath);
}

function gitError(result: GitCommandResult, code: string): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || code;
  return new Error(`${code}: ${detail.slice(-1000)}`);
}

export class GitCheckpointStore implements CheckpointService {
  private readonly repoPath: string;
  private readonly git: GitCommandRunner;
  private readonly metadataStore: CheckpointMetadataStore | undefined;
  private readonly checkpoints = new Map<string, Checkpoint>();

  constructor(options: {
    repoPath: string;
    gitPath?: string;
    commandRunner?: GitCommandRunner;
    metadataStore?: CheckpointMetadataStore;
  }) {
    this.repoPath = assertRepoPath(options.repoPath);
    this.git = options.commandRunner ?? spawnGit(options.gitPath ?? 'git');
    this.metadataStore = options.metadataStore;
  }

  async create(
    input: Omit<Checkpoint, 'id' | 'status' | 'createdAt'>,
  ): Promise<Checkpoint> {
    const commitRef = await this.head();
    const checkpoint: Checkpoint = {
      ...input,
      id: randomUUID(),
      commitRef,
      status: 'valid',
      createdAt: new Date().toISOString(),
    };
    if (this.metadataStore) await this.metadataStore.save(checkpoint);
    else this.checkpoints.set(checkpoint.id, checkpoint);
    return structuredClone(checkpoint);
  }

  async commitWorkingTree(
    input: Omit<Checkpoint, 'id' | 'status' | 'createdAt' | 'commitRef'>,
  ): Promise<Checkpoint> {
    const declaredPaths = Array.isArray(input.changeManifest.paths)
      ? input.changeManifest.paths.filter(
          (path): path is string => typeof path === 'string',
        )
      : Object.keys(input.changeManifest);
    const paths = declaredPaths.filter(
      (path) => path && !path.startsWith('/') && !path.includes('..'),
    );
    if (paths.length === 0) throw new Error('GIT_CHANGE_MANIFEST_EMPTY');
    const add = await this.git(['add', '--', ...paths], this.repoPath);
    if (add.exitCode !== 0) throw gitError(add, 'GIT_ADD_FAILED');
    const commit = await this.git(
      ['commit', '--no-verify', '-m', input.summary],
      this.repoPath,
    );
    if (commit.exitCode !== 0) throw gitError(commit, 'GIT_COMMIT_FAILED');
    const checkpoint: Checkpoint = {
      ...input,
      id: randomUUID(),
      commitRef: await this.head(),
      status: 'valid',
      createdAt: new Date().toISOString(),
    };
    if (this.metadataStore) await this.metadataStore.save(checkpoint);
    else this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  async get(id: string, projectId: string): Promise<Checkpoint> {
    if (this.metadataStore) return this.metadataStore.get(id, projectId);
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint || checkpoint.projectId !== projectId)
      throw new Error('CHECKPOINT_NOT_FOUND');
    return structuredClone(checkpoint);
  }

  async list(projectId: string): Promise<Checkpoint[]> {
    if (this.metadataStore) return this.metadataStore.list(projectId);
    return [...this.checkpoints.values()]
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .map((checkpoint) => structuredClone(checkpoint));
  }

  async restore(id: string, projectId: string): Promise<Checkpoint> {
    const checkpoint = await this.get(id, projectId);
    if (checkpoint.status !== 'valid' && checkpoint.status !== 'restored')
      throw new Error('CHECKPOINT_INVALID');
    const reset = await this.git(
      ['reset', '--hard', checkpoint.commitRef],
      this.repoPath,
    );
    if (reset.exitCode !== 0) throw gitError(reset, 'GIT_RESTORE_FAILED');
    checkpoint.status = 'restored';
    if (this.metadataStore)
      return this.metadataStore.markRestored(id, projectId);
    this.checkpoints.set(id, checkpoint);
    return structuredClone(checkpoint);
  }

  async head(): Promise<string> {
    const result = await this.git(['rev-parse', 'HEAD'], this.repoPath);
    if (result.exitCode !== 0) throw gitError(result, 'GIT_HEAD_FAILED');
    const commitRef = result.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commitRef)) throw new Error('GIT_HEAD_INVALID');
    return commitRef;
  }

  async workingTreeHash(): Promise<string> {
    const result = await this.git(['write-tree'], this.repoPath);
    if (result.exitCode !== 0) throw gitError(result, 'GIT_TREE_FAILED');
    return `sha256-${createHash('sha256').update(result.stdout.trim()).digest('hex')}`;
  }
}
