import { randomUUID } from 'node:crypto';
import type { GameSpecVersion, Project } from '../index';

export class RepositoryNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
}

export class RepositoryConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
}

export interface TenantScope {
  ownerId: string;
}

export interface RepositoryTransaction {
  readonly scope: TenantScope;
  commit(): void;
  rollback(): void;
}

export class InMemoryProjectRepository {
  private readonly projects = new Map<string, Project>();
  private readonly specs = new Map<string, GameSpecVersion>();

  begin(scope: TenantScope): RepositoryTransaction {
    return {
      scope,
      commit: () => undefined,
      rollback: () => undefined,
    };
  }

  createProject(
    input: Pick<Project, 'ownerId' | 'name' | 'slug' | 'quotaProfile'> &
      Partial<Pick<Project, 'id'>>,
  ): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: input.id ?? randomUUID(),
      ownerId: input.ownerId,
      name: input.name,
      slug: input.slug,
      status: 'draft',
      engineType: 'unity',
      engineVersion: '6000.0.80f1',
      workspaceRepoKey: `projects/${input.ownerId}/${input.slug}`,
      quotaProfile: input.quotaProfile,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.projects.set(project.id, project);
    return project;
  }

  restoreProject(project: Project): void {
    this.projects.set(project.id, structuredClone(project));
  }

  allProjects(): Project[] {
    return [...this.projects.values()].map((project) =>
      structuredClone(project),
    );
  }

  getProject(id: string, scope: TenantScope): Project {
    const project = this.projects.get(id);
    if (!project || project.ownerId !== scope.ownerId)
      throw new RepositoryNotFoundError(`Project ${id} was not found`);
    return structuredClone(project);
  }

  listProjects(scope: TenantScope): Project[] {
    return [...this.projects.values()]
      .filter((project) => project.ownerId === scope.ownerId)
      .map((project) => structuredClone(project));
  }

  updateProject(
    id: string,
    scope: TenantScope,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Project,
        | 'name'
        | 'status'
        | 'currentSpecVersionId'
        | 'currentCheckpointId'
        | 'currentBuildId'
      >
    >,
  ): Project {
    const current = this.getProject(id, scope);
    if (current.version !== expectedVersion)
      throw new RepositoryConflictError(
        `Project ${id} is at version ${current.version}`,
      );
    const updated: Project = {
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(id, updated);
    return structuredClone(updated);
  }

  saveSpec(spec: GameSpecVersion, scope: TenantScope): GameSpecVersion {
    this.getProject(spec.projectId, scope);
    const duplicate = [...this.specs.values()].find(
      (item) =>
        item.projectId === spec.projectId &&
        item.contentHash === spec.contentHash &&
        item.id !== spec.id,
    );
    if (duplicate)
      throw new RepositoryConflictError(
        `Duplicate spec content ${spec.contentHash}`,
      );
    this.specs.set(spec.id, structuredClone(spec));
    return structuredClone(spec);
  }

  listSpecs(projectId: string, scope: TenantScope): GameSpecVersion[] {
    this.getProject(projectId, scope);
    return [...this.specs.values()]
      .filter((spec) => spec.projectId === projectId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((spec) => structuredClone(spec));
  }
}

export * from './outbox';
