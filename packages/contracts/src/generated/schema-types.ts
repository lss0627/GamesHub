/** Generated from the versioned JSON schema contracts. */
export type SchemaVersion = '1.0.0';
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
export interface SchemaArtifact {
  schema_version: SchemaVersion;
  content_hash: string;
}
