CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE project_status AS ENUM ('draft', 'creating', 'playable', 'degraded', 'archived');
CREATE TYPE spec_status AS ENUM ('proposed', 'active', 'superseded', 'rejected');
CREATE TYPE run_status AS ENUM ('queued', 'planning', 'waiting_for_engine', 'executing', 'playtesting', 'evaluating', 'fixing', 'pause_requested', 'paused', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'timed_out');
CREATE TYPE task_status AS ENUM ('pending', 'running', 'blocked', 'failed', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  role text NOT NULL CHECK (role IN ('creator', 'developer', 'operator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug text NOT NULL,
  status project_status NOT NULL DEFAULT 'draft',
  engine_type text NOT NULL DEFAULT 'unity' CHECK (engine_type = 'unity'),
  engine_version text NOT NULL DEFAULT '6000.0.80f1',
  current_spec_version_id uuid,
  current_checkpoint_id uuid,
  current_build_id uuid,
  workspace_repo_key text NOT NULL,
  quota_profile text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (owner_id, slug)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  runtime_type text NOT NULL,
  runtime_session_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'idle', 'cancelled', 'closed', 'error')),
  last_event_sequence bigint NOT NULL DEFAULT 0,
  context_snapshot_key text,
  model_route_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  session_id uuid NOT NULL REFERENCES agent_sessions(id),
  parent_run_id uuid REFERENCES runs(id),
  request_type text NOT NULL CHECK (request_type IN ('create', 'modify', 'validate', 'rollback', 'publish')),
  user_input text NOT NULL,
  status run_status NOT NULL DEFAULT 'queued',
  fix_iteration integer NOT NULL DEFAULT 0 CHECK (fix_iteration >= 0 AND fix_iteration <= max_fix_iterations),
  max_fix_iterations integer NOT NULL DEFAULT 5 CHECK (max_fix_iterations BETWEEN 0 AND 5),
  idempotency_key text NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_summary text,
  unresolved_issue_count integer NOT NULL DEFAULT 0 CHECK (unresolved_issue_count >= 0),
  recovery_sequence bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS game_spec_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  schema_version text NOT NULL DEFAULT '1.0.0',
  parent_version_id uuid REFERENCES game_spec_versions(id),
  source_run_id uuid NOT NULL REFERENCES runs(id),
  change_type text NOT NULL CHECK (change_type IN ('create', 'modify', 'rollback', 'migration')),
  summary text NOT NULL,
  spec_json jsonb NOT NULL,
  semantic_diff jsonb NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  status spec_status NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (project_id, version_number),
  UNIQUE (project_id, content_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_spec_per_project ON game_spec_versions(project_id) WHERE status = 'active';
ALTER TABLE projects ADD CONSTRAINT projects_current_spec_fk FOREIGN KEY (current_spec_version_id) REFERENCES game_spec_versions(id);

CREATE TABLE IF NOT EXISTS task_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  game_spec_version_id uuid NOT NULL REFERENCES game_spec_versions(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  kind text NOT NULL CHECK (kind IN ('create', 'modify', 'fix', 'rollback', 'validate', 'publish')),
  planner_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'validated', 'executing', 'completed', 'failed', 'cancelled')),
  graph_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_graph_id uuid NOT NULL REFERENCES task_graphs(id),
  task_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('spec', 'scene', 'component', 'script', 'asset', 'test', 'playtest', 'evaluate', 'fix', 'build', 'publish', 'rollback')),
  description text NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 10),
  validation_method jsonb NOT NULL,
  related_files text[] NOT NULL DEFAULT '{}',
  related_scenes text[] NOT NULL DEFAULT '{}',
  capabilities text[] NOT NULL DEFAULT '{}',
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (task_graph_id, task_key)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_graph_id uuid NOT NULL REFERENCES task_graphs(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id),
  kind text NOT NULL CHECK (kind IN ('hard', 'validation', 'artifact')),
  PRIMARY KEY (task_graph_id, task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS run_events (
  run_id uuid NOT NULL REFERENCES runs(id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('creator', 'developer', 'operator', 'audit')),
  payload jsonb NOT NULL,
  trace_id text,
  span_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS runs_queue_idx ON runs(status, created_at) WHERE status IN ('queued', 'waiting_for_engine', 'paused');
CREATE INDEX IF NOT EXISTS runs_lease_recovery_idx ON runs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS run_events_occurred_idx ON run_events(occurred_at);
