import { createHash } from 'node:crypto';

export interface BuildProvenance {
  schemaVersion: '1.0.0';
  buildId: string;
  engine: { name: 'unity'; version: string; packageLockHash: string };
  dependencies: Array<{ name: string; version: string; license: string }>;
  assets: Array<{ logicalId: string; contentHash: string; license: string }>;
  sbomHash: string;
}

export function createBuildProvenance(
  input: Omit<BuildProvenance, 'schemaVersion' | 'sbomHash'>,
): BuildProvenance {
  const body = { schemaVersion: '1.0.0' as const, ...input };
  return {
    ...body,
    sbomHash: `sha256-${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`,
  };
}
