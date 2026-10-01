import { createHash, randomUUID } from 'node:crypto';
import { parseGameSpec } from '@gamerhub/contracts';
import type { GameSpec, GameSpecVersionRecord } from './types';

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalizeGameSpec(spec: unknown): string {
  return JSON.stringify(canonicalValue(spec));
}

export function hashGameSpec(spec: unknown): string {
  return `sha256-${createHash('sha256').update(canonicalizeGameSpec(spec)).digest('hex')}`;
}

export function validateGameSpec(value: unknown): GameSpec {
  return parseGameSpec(value) as GameSpec;
}

export interface GameSpecPersistence {
  save(version: GameSpecVersionRecord): Promise<void>;
  activate(projectId: string, versionId: string): Promise<void>;
  list(projectId: string): Promise<GameSpecVersionRecord[]>;
  findBySourceRun?(
    projectId: string,
    sourceRunId: string,
  ): Promise<GameSpecVersionRecord | undefined>;
  findByContentHash?(
    projectId: string,
    contentHash: string,
  ): Promise<GameSpecVersionRecord | undefined>;
}

export class GameSpecService {
  private readonly versions = new Map<string, GameSpecVersionRecord>();

  constructor(private readonly persistence?: GameSpecPersistence) {}

  createVersion(input: {
    projectId: string;
    sourceRunId: string;
    spec: unknown;
    summary: string;
    changeType?: GameSpecVersionRecord['changeType'];
    parentVersionId?: string;
  }): GameSpecVersionRecord {
    const spec = validateGameSpec(input.spec);
    const projectVersions = [...this.versions.values()].filter(
      (version) => version.projectId === input.projectId,
    );
    if (!input.summary.trim()) throw new Error('SPEC_SUMMARY_REQUIRED');
    if (input.parentVersionId) {
      const parent = this.versions.get(input.parentVersionId);
      if (!parent || parent.projectId !== input.projectId)
        throw new Error('SPEC_PARENT_INVALID');
    }
    const record: GameSpecVersionRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      versionNumber:
        Math.max(
          0,
          ...projectVersions.map((version) => version.versionNumber),
        ) + 1,
      ...(input.parentVersionId
        ? { parentVersionId: input.parentVersionId }
        : {}),
      sourceRunId: input.sourceRunId,
      changeType: input.changeType ?? 'create',
      summary: input.summary,
      spec,
      contentHash: hashGameSpec(spec),
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    this.versions.set(record.id, record);
    return structuredClone(record);
  }

  activate(versionId: string): GameSpecVersionRecord {
    const selected = this.versions.get(versionId);
    if (!selected) throw new Error('SPEC_VERSION_NOT_FOUND');
    for (const version of this.versions.values()) {
      if (
        version.projectId === selected.projectId &&
        version.status === 'active'
      )
        version.status = 'superseded';
    }
    selected.status = 'active';
    return structuredClone(selected);
  }

  async createVersionAndPersist(input: {
    projectId: string;
    sourceRunId: string;
    spec: unknown;
    summary: string;
    changeType?: GameSpecVersionRecord['changeType'];
    parentVersionId?: string;
  }): Promise<GameSpecVersionRecord> {
    const incomingHash = hashGameSpec(validateGameSpec(input.spec));
    const existing = await this.persistence?.findBySourceRun?.(
      input.projectId,
      input.sourceRunId,
    );
    if (existing) {
      if (existing.contentHash !== incomingHash)
        throw new Error('SPEC_SOURCE_RUN_CONFLICT');
      this.versions.set(existing.id, structuredClone(existing));
      return structuredClone(existing);
    }
    const equivalent = await this.persistence?.findByContentHash?.(
      input.projectId,
      incomingHash,
    );
    if (equivalent) {
      this.versions.set(equivalent.id, structuredClone(equivalent));
      return structuredClone(equivalent);
    }
    // Hydrate version numbers and parent records after a worker restart.
    if (this.persistence) await this.listDurably(input.projectId);
    const inMemory = this.list(input.projectId).find(
      (version) => version.sourceRunId === input.sourceRunId,
    );
    if (inMemory) {
      if (inMemory.contentHash !== incomingHash)
        throw new Error('SPEC_SOURCE_RUN_CONFLICT');
      return inMemory;
    }
    const record = this.createVersion(input);
    try {
      await this.persistence?.save(record);
    } catch (error) {
      this.versions.delete(record.id);
      throw error;
    }
    const persisted = await this.persistence?.findByContentHash?.(
      input.projectId,
      record.contentHash,
    );
    if (!persisted) return record;
    if (persisted.id !== record.id) this.versions.delete(record.id);
    this.versions.set(persisted.id, structuredClone(persisted));
    return structuredClone(persisted);
  }

  async activateAndPersist(versionId: string): Promise<GameSpecVersionRecord> {
    const selected = this.versions.get(versionId);
    if (!selected) throw new Error('SPEC_VERSION_NOT_FOUND');
    await this.persistence?.activate(selected.projectId, versionId);
    return this.activate(versionId);
  }

  async listDurably(projectId: string): Promise<GameSpecVersionRecord[]> {
    if (!this.persistence) return this.list(projectId);
    const versions = await this.persistence.list(projectId);
    for (const version of versions)
      this.versions.set(version.id, structuredClone(version));
    return versions.map((version) => structuredClone(version));
  }

  get(versionId: string): GameSpecVersionRecord | undefined {
    const version = this.versions.get(versionId);
    return version ? structuredClone(version) : undefined;
  }

  list(projectId: string): GameSpecVersionRecord[] {
    return [...this.versions.values()]
      .filter((version) => version.projectId === projectId)
      .sort((left, right) => left.versionNumber - right.versionNumber)
      .map((version) => structuredClone(version));
  }
}
