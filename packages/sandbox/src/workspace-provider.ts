import { existsSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';

function canonicalIfPresent(candidate: string): string {
  let cursor = candidate;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return candidate;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  return normalize(join(realpathSync.native(cursor), ...suffix));
}

export class WorkspaceProvider {
  readonly root: string;
  constructor(root: string) {
    this.root = normalize(resolve(root));
  }

  resolve(relativePath: string): string {
    if (
      isAbsolute(relativePath) ||
      /^[A-Za-z]:[\\/]/.test(relativePath) ||
      relativePath.split(/[\\/]/).includes('..')
    )
      throw new Error('WORKSPACE_ESCAPE');
    const candidate = normalize(resolve(this.root, relativePath));
    const relation = relative(
      canonicalIfPresent(this.root),
      canonicalIfPresent(candidate),
    );
    if (
      relation === '..' ||
      relation.startsWith('..' + '/') ||
      relation.startsWith('..' + '\\') ||
      /^[A-Za-z]:/.test(relation)
    )
      throw new Error('WORKSPACE_ESCAPE');
    return candidate;
  }

  seal(): { root: string; sealed: true } {
    return { root: this.root, sealed: true };
  }
}

export class SandboxPolicy {
  readonly network: 'deny' | 'proxy';
  readonly maxCpu = 4;
  readonly maxMemoryMb = 8192;
  readonly maxDiskGb = 20;
  readonly maxPids = 128;
  readonly maxWallClockSeconds = 1200;
  constructor(
    private readonly projectRoot = 'D:/worker/projects/project-1',
    options: { network?: 'deny' | 'proxy' } = {},
  ) {
    this.network = options.network ?? 'deny';
  }

  allowsEgress(host: string, port: number): boolean {
    return (
      this.network === 'proxy' &&
      host === 'package-cache.internal' &&
      port === 443
    );
  }

  withinLimits(usage: {
    cpu: number;
    memoryMb: number;
    diskGb: number;
    pids: number;
    wallClockSeconds: number;
  }): boolean {
    return (
      usage.cpu >= 0 &&
      usage.cpu <= this.maxCpu &&
      usage.memoryMb >= 0 &&
      usage.memoryMb <= this.maxMemoryMb &&
      usage.diskGb >= 0 &&
      usage.diskGb <= this.maxDiskGb &&
      usage.pids >= 0 &&
      usage.pids <= this.maxPids &&
      usage.wallClockSeconds >= 0 &&
      usage.wallClockSeconds <= this.maxWallClockSeconds
    );
  }

  assertWithinLimits(usage: {
    cpu: number;
    memoryMb: number;
    diskGb: number;
    pids: number;
    wallClockSeconds: number;
  }): void {
    if (!this.withinLimits(usage)) throw new Error('SANDBOX_RESOURCE_LIMIT');
  }

  allowsPath(candidate: string): boolean {
    try {
      const root = canonicalIfPresent(
        normalize(resolve(this.projectRoot)),
      ).toLowerCase();
      const path = canonicalIfPresent(
        normalize(resolve(candidate)),
      ).toLowerCase();
      const relation = relative(root, path);
      return (
        relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
      );
    } catch {
      return false;
    }
  }
}
