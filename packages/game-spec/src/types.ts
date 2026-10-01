import type { parseGameSpec } from '@gamerhub/contracts';

export type GameSpec = ReturnType<typeof parseGameSpec>;

export interface GameSpecVersionRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  parentVersionId?: string;
  sourceRunId: string;
  changeType: 'create' | 'modify' | 'rollback' | 'migration';
  summary: string;
  spec: GameSpec;
  contentHash: string;
  status: 'proposed' | 'active' | 'superseded' | 'rejected';
  createdAt: string;
}
