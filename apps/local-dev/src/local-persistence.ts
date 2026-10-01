import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type CreateRunInput,
  InMemoryPlatformStore,
  type InMemoryPlatformStoreSnapshot,
  type NewRunEvent,
  type Project,
  type Run,
  type RunEvent,
  type RunStatus,
} from '@gamerhub/domain';
import type {
  GameSpecPersistence,
  GameSpecVersionRecord,
} from '@gamerhub/game-spec';

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${randomUUID()}.tmp`;
  await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(staging, path);
}

function platformSnapshot(value: unknown): InMemoryPlatformStoreSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('LOCAL_PLATFORM_SNAPSHOT_INVALID');
  const snapshot = value as Partial<InMemoryPlatformStoreSnapshot>;
  if (
    snapshot.schemaVersion !== '1.0.0' ||
    !Array.isArray(snapshot.projects) ||
    !Array.isArray(snapshot.runs) ||
    !Array.isArray(snapshot.events)
  )
    throw new Error('LOCAL_PLATFORM_SNAPSHOT_INVALID');
  return snapshot as InMemoryPlatformStoreSnapshot;
}

export class LocalJsonPlatformStore extends InMemoryPlatformStore {
  private persistence = Promise.resolve();

  private constructor(
    private readonly path: string,
    snapshot?: InMemoryPlatformStoreSnapshot,
  ) {
    super(snapshot);
  }

  static async open(path: string): Promise<LocalJsonPlatformStore> {
    const snapshot = existsSync(path)
      ? platformSnapshot(JSON.parse(await readFile(path, 'utf8')))
      : undefined;
    const store = new LocalJsonPlatformStore(path, snapshot);
    if (snapshot) await store.persist();
    return store;
  }

  override async createProject(
    input: Pick<Project, 'ownerId' | 'name' | 'slug' | 'quotaProfile'>,
  ): Promise<Project> {
    const result = await super.createProject(input);
    await this.persist();
    return result;
  }

  override async createRun(
    input: CreateRunInput,
  ): Promise<{ run: Run; created: boolean }> {
    const result = await super.createRun(input);
    if (result.created) await this.persist();
    return result;
  }

  override async claimNextRun(
    workerId: string,
    leaseSeconds?: number,
  ): Promise<Run | undefined> {
    const result = await super.claimNextRun(workerId, leaseSeconds);
    if (result) await this.persist();
    return result;
  }

  override async transitionRun(
    runId: string,
    nextStatus: RunStatus,
    input: Omit<NewRunEvent, 'runId' | 'eventType'> & {
      eventType?: string;
    },
    expectedLeaseOwner?: string,
  ): Promise<{ run: Run; event: RunEvent }> {
    const result = await super.transitionRun(
      runId,
      nextStatus,
      input,
      expectedLeaseOwner,
    );
    await this.persist();
    return result;
  }

  override async appendEvent(input: NewRunEvent): Promise<RunEvent> {
    const result = await super.appendEvent(input);
    await this.persist();
    return result;
  }

  override async updateRun(
    runId: string,
    patch: Parameters<InMemoryPlatformStore['updateRun']>[1],
    expectedLeaseOwner?: string,
  ): Promise<Run> {
    const result = await super.updateRun(runId, patch, expectedLeaseOwner);
    await this.persist();
    return result;
  }

  private persist(): Promise<void> {
    this.persistence = this.persistence.then(() =>
      writeJson(this.path, this.snapshot()),
    );
    return this.persistence;
  }
}

interface LocalGameSpecSnapshot {
  schemaVersion: '1.0.0';
  versions: GameSpecVersionRecord[];
}

export class LocalJsonGameSpecPersistence implements GameSpecPersistence {
  private readonly versions = new Map<string, GameSpecVersionRecord>();
  private persistence = Promise.resolve();

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<LocalJsonGameSpecPersistence> {
    const persistence = new LocalJsonGameSpecPersistence(path);
    if (!existsSync(path)) return persistence;
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('LOCAL_GAME_SPEC_SNAPSHOT_INVALID');
    const snapshot = parsed as Partial<LocalGameSpecSnapshot>;
    if (snapshot.schemaVersion !== '1.0.0' || !Array.isArray(snapshot.versions))
      throw new Error('LOCAL_GAME_SPEC_SNAPSHOT_INVALID');
    for (const version of snapshot.versions)
      persistence.versions.set(version.id, structuredClone(version));
    return persistence;
  }

  async save(version: GameSpecVersionRecord): Promise<void> {
    this.versions.set(version.id, structuredClone(version));
    await this.persist();
  }

  async activate(projectId: string, versionId: string): Promise<void> {
    const selected = this.versions.get(versionId);
    if (!selected || selected.projectId !== projectId)
      throw new Error('SPEC_VERSION_NOT_FOUND');
    for (const version of this.versions.values()) {
      if (version.projectId !== projectId) continue;
      if (version.status === 'active') version.status = 'superseded';
    }
    selected.status = 'active';
    await this.persist();
  }

  list(projectId: string): Promise<GameSpecVersionRecord[]> {
    return Promise.resolve(
      [...this.versions.values()]
        .filter((version) => version.projectId === projectId)
        .sort((left, right) => left.versionNumber - right.versionNumber)
        .map((version) => structuredClone(version)),
    );
  }

  findBySourceRun(
    projectId: string,
    sourceRunId: string,
  ): Promise<GameSpecVersionRecord | undefined> {
    const version = [...this.versions.values()].find(
      (item) =>
        item.projectId === projectId && item.sourceRunId === sourceRunId,
    );
    return Promise.resolve(version ? structuredClone(version) : undefined);
  }

  findByContentHash(
    projectId: string,
    contentHash: string,
  ): Promise<GameSpecVersionRecord | undefined> {
    const version = [...this.versions.values()].find(
      (item) =>
        item.projectId === projectId && item.contentHash === contentHash,
    );
    return Promise.resolve(version ? structuredClone(version) : undefined);
  }

  private persist(): Promise<void> {
    const snapshot: LocalGameSpecSnapshot = {
      schemaVersion: '1.0.0',
      versions: [...this.versions.values()],
    };
    this.persistence = this.persistence.then(() =>
      writeJson(this.path, snapshot),
    );
    return this.persistence;
  }
}
