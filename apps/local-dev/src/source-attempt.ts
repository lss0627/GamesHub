import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  restoreSource,
  safeSourcePath,
  snapshotSource,
} from './source-snapshot';

export interface SourceAttempt {
  schemaVersion: '1.0.0';
  projectId: string;
  runId: string;
  baselineRevision: string;
  status: 'active' | 'recovering' | 'recovered' | 'committed';
  archivedRevision?: string;
  finalRevision?: string;
  updatedAt: string;
}
const terminalFailures = new Set([
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
  'out_of_scope',
  'partially_succeeded',
]);
const revision = /^source-[a-f0-9]{64}$/;
function safeId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new Error('SOURCE_ATTEMPT_ID_INVALID');
  return value;
}

/** The caller owns the project's run lease. All recovery bytes remain project-local. */
export class SourceAttemptStore {
  constructor(
    private readonly root: string,
    private readonly projectId: string,
  ) {
    safeId(projectId);
  }
  private async path(runId: string) {
    return safeSourcePath(
      this.root,
      `.gamerhub/attempts/${safeId(runId)}.json`,
    );
  }
  private async read(runId: string): Promise<SourceAttempt | undefined> {
    const path = await this.path(runId);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    let record: SourceAttempt;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error('SOURCE_ATTEMPT_CORRUPT');
    }
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('SOURCE_ATTEMPT_CORRUPT');
    if (record.projectId !== this.projectId)
      throw new Error('SOURCE_ATTEMPT_PROJECT_MISMATCH');
    if (
      raw.length > 16000 ||
      record.schemaVersion !== '1.0.0' ||
      record.runId !== runId ||
      !revision.test(record.baselineRevision) ||
      !['active', 'recovering', 'recovered', 'committed'].includes(
        record.status,
      ) ||
      (record.archivedRevision !== undefined &&
        !revision.test(record.archivedRevision)) ||
      (record.finalRevision !== undefined &&
        !revision.test(record.finalRevision))
    )
      throw new Error('SOURCE_ATTEMPT_CORRUPT');
    return record;
  }
  private async save(record: SourceAttempt): Promise<SourceAttempt> {
    const path = await this.path(record.runId);
    await mkdir(dirname(path), { recursive: true });
    const staged = `${path}.${randomUUID()}.tmp`;
    const next = { ...record, updatedAt: new Date().toISOString() };
    try {
      await writeFile(staged, JSON.stringify(next), { flag: 'wx' });
      await rename(staged, path);
    } finally {
      await unlink(staged).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return next;
  }
  async begin(
    runId: string,
    outcome: (runId: string) => Promise<string> = async () => 'unknown',
  ): Promise<SourceAttempt> {
    safeId(runId);
    const directory = await safeSourcePath(this.root, '.gamerhub/attempts');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      names = [];
    }
    for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
      const other = await this.read(name.slice(0, -5));
      if (
        !other ||
        other.runId === runId ||
        ['committed', 'recovered'].includes(other.status)
      )
        continue;
      const status = await outcome(other.runId);
      if (status === 'succeeded') await this.settle(other.runId, 'succeeded');
      else if (terminalFailures.has(status))
        await this.settle(other.runId, 'failed');
      else throw new Error('SOURCE_ATTEMPT_ACTIVE');
    }
    const existing = await this.read(runId);
    if (existing) {
      if (existing.status !== 'active')
        throw new Error('SOURCE_ATTEMPT_SETTLED');
      return existing;
    }
    return this.save({
      schemaVersion: '1.0.0',
      projectId: this.projectId,
      runId,
      baselineRevision: await snapshotSource(this.root),
      status: 'active',
      updatedAt: new Date().toISOString(),
    });
  }
  async settle(
    runId: string,
    outcome: 'succeeded' | 'failed' | 'cancelled',
  ): Promise<SourceAttempt> {
    const record = await this.read(runId);
    if (!record) throw new Error('SOURCE_ATTEMPT_NOT_FOUND');
    if (record.status === 'committed' || record.status === 'recovered')
      return record;
    if (outcome === 'succeeded')
      return this.save({
        ...record,
        status: 'committed',
        finalRevision: await snapshotSource(this.root),
      });
    const recovering =
      record.status === 'recovering'
        ? record
        : await this.save({
            ...record,
            status: 'recovering',
            archivedRevision: await snapshotSource(this.root),
          });
    await restoreSource(this.root, recovering.baselineRevision);
    return this.save({ ...recovering, status: 'recovered' });
  }
}
