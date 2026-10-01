export type UUID = string;

export type ProjectStatus =
  | 'draft'
  | 'creating'
  | 'playable'
  | 'degraded'
  | 'archived';
export type RunStatus =
  | 'queued'
  | 'planning'
  | 'waiting_for_engine'
  | 'executing'
  | 'playtesting'
  | 'evaluating'
  | 'fixing'
  | 'pause_requested'
  | 'paused'
  | 'succeeded'
  | 'partially_succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'cancelled';
export type BuildStatus =
  | 'building'
  | 'validating'
  | 'ready'
  | 'published'
  | 'failed'
  | 'superseded';
export type Visibility = 'creator' | 'developer' | 'operator' | 'audit';

export interface VersionedRecord {
  id: UUID;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Project extends VersionedRecord {
  ownerId: UUID;
  name: string;
  slug: string;
  status: ProjectStatus;
  engineType: 'unity';
  engineVersion: '6000.0.80f1';
  currentSpecVersionId?: UUID;
  currentCheckpointId?: UUID;
  currentBuildId?: UUID;
  workspaceRepoKey: string;
  quotaProfile: string;
}

export interface GameSpecVersion extends VersionedRecord {
  projectId: UUID;
  versionNumber: number;
  schemaVersion: '1.0.0';
  parentVersionId?: UUID;
  sourceRunId: UUID;
  changeType: 'create' | 'modify' | 'rollback' | 'migration';
  summary: string;
  specJson: Record<string, unknown>;
  semanticDiff: Record<string, unknown>;
  contentHash: string;
  status: 'proposed' | 'active' | 'superseded' | 'rejected';
}

export interface Task extends VersionedRecord {
  taskGraphId: UUID;
  taskKey: string;
  type:
    | 'spec'
    | 'scene'
    | 'component'
    | 'script'
    | 'asset'
    | 'test'
    | 'playtest'
    | 'evaluate'
    | 'fix'
    | 'build'
    | 'publish'
    | 'rollback';
  description: string;
  status: TaskStatus;
  retryCount: number;
  maxRetries: number;
  validationMethod: { type: string; reference: string };
  relatedFiles: string[];
  relatedScenes: string[];
  capabilities: string[];
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface TaskDependency {
  taskGraphId: UUID;
  taskId: UUID;
  dependsOnTaskId: UUID;
  kind: 'hard' | 'validation' | 'artifact';
}

export interface TaskGraph extends VersionedRecord {
  projectId: UUID;
  gameSpecVersionId: UUID;
  runId: UUID;
  kind: 'create' | 'modify' | 'fix' | 'rollback' | 'validate' | 'publish';
  plannerVersion: string;
  status:
    | 'draft'
    | 'validated'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  graphHash: string;
  tasks: Task[];
  dependencies: TaskDependency[];
}

export interface AgentSession extends VersionedRecord {
  projectId: UUID;
  runtimeType: string;
  runtimeSessionRef: string;
  status: 'active' | 'idle' | 'cancelled' | 'closed' | 'error';
  lastEventSequence: number;
  contextSnapshotKey?: string;
  modelRouteSnapshot: Record<string, unknown>;
}

export interface Run extends VersionedRecord {
  projectId: UUID;
  sessionId: UUID;
  traceId: string;
  parentRunId?: UUID;
  requestType: 'create' | 'modify' | 'validate' | 'rollback' | 'publish';
  userInput: string;
  status: RunStatus;
  fixIteration: number;
  maxFixIterations: number;
  idempotencyKey: string;
  leaseOwner?: string | undefined;
  leaseExpiresAt?: string | undefined;
  startedAt?: string;
  finishedAt?: string;
  resultSummary?: string;
  unresolvedIssueCount: number;
  recoverySequence?: number;
}

export interface Build extends VersionedRecord {
  projectId: UUID;
  checkpointId: UUID;
  specVersionId: UUID;
  target: 'unity_web';
  status: BuildStatus;
  engineVersion: '6000.0.80f1';
  adapterVersion: string;
  templateVersion: string;
  packageLockHash: string;
  artifactKey?: string;
  contentHash?: string;
  sizeBytes?: number;
  evaluationReportId?: UUID;
  buildLogKey?: string;
}

export interface RunEvent {
  runId: UUID;
  sequence: number;
  schemaVersion: '1.0.0';
  eventType: string;
  visibility: Visibility;
  payload: Record<string, unknown>;
  occurredAt: string;
  traceId?: string;
  spanId?: string;
}

export * from './repositories';
export * from './repositories/evaluations';
export * from './repositories/platform-store';
export * from './repositories/postgres';
export * from './repositories/run-events';
export * from './state-machines';
