import { createHash } from 'node:crypto';

export interface ImmutableBuild {
  id: string;
  projectId: string;
  contentHash: string;
  artifactKey: string;
  status: 'ready' | 'published' | 'superseded';
  previewUrl: string;
  createdAt: string;
}

export class BuildService {
  private readonly builds = new Map<string, ImmutableBuild>();
  private readonly current = new Map<string, string>();

  publish(input: {
    id: string;
    projectId: string;
    bytes: Uint8Array;
    artifactKey?: string;
  }): ImmutableBuild {
    const contentHash = `sha256-${createHash('sha256').update(input.bytes).digest('hex')}`;
    const existingById = this.builds.get(input.id);
    if (existingById) {
      if (existingById.contentHash !== contentHash)
        throw new Error('BUILD_ID_CONFLICT');
      return structuredClone(existingById);
    }
    const existingByHash = [...this.builds.values()].find(
      (build) =>
        build.projectId === input.projectId &&
        build.contentHash === contentHash,
    );
    if (existingByHash) {
      const previousId = this.current.get(input.projectId);
      if (previousId && previousId !== existingByHash.id) {
        const previous = this.builds.get(previousId);
        if (previous) previous.status = 'superseded';
      }
      existingByHash.status = 'published';
      this.current.set(input.projectId, existingByHash.id);
      return structuredClone(existingByHash);
    }
    const previousId = this.current.get(input.projectId);
    if (previousId) {
      const previous = this.builds.get(previousId);
      if (previous) previous.status = 'superseded';
    }
    const artifactKey =
      input.artifactKey ?? `builds/${input.projectId}/${contentHash}`;
    const build: ImmutableBuild = {
      id: input.id,
      projectId: input.projectId,
      contentHash,
      artifactKey,
      status: 'published',
      previewUrl: `/previews/${encodeURIComponent(input.projectId)}/${encodeURIComponent(contentHash)}/index.html`,
      createdAt: new Date().toISOString(),
    };
    this.builds.set(build.id, build);
    this.current.set(input.projectId, build.id);
    return structuredClone(build);
  }

  get(id: string): ImmutableBuild {
    const build = this.builds.get(id);
    if (!build) throw new Error('BUILD_NOT_FOUND');
    return structuredClone(build);
  }

  currentFor(projectId: string): ImmutableBuild | undefined {
    const id = this.current.get(projectId);
    return id ? this.get(id) : undefined;
  }
}
