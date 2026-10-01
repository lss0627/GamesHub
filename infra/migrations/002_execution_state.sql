CREATE TABLE IF NOT EXISTS model_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), task_id uuid REFERENCES tasks(id), role text NOT NULL, provider text NOT NULL, model text NOT NULL, request_hash text NOT NULL, response_hash text, prompt_tokens integer, completion_tokens integer, cached_tokens integer, latency_ms integer, status text NOT NULL, error_code text, started_at timestamptz NOT NULL, finished_at timestamptz, redacted_trace_key text
);
CREATE TABLE IF NOT EXISTS tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), task_id uuid NOT NULL REFERENCES tasks(id), tool_name text NOT NULL, tool_version text NOT NULL, safety_class text NOT NULL, input_hash text NOT NULL, output_hash text, status text NOT NULL, retryable boolean NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz, latency_ms integer, error_code text, evidence_key text
);
CREATE TABLE IF NOT EXISTS skill_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), task_id uuid NOT NULL REFERENCES tasks(id), skill_name text NOT NULL, skill_version text NOT NULL, engine_adapter text NOT NULL, input_hash text NOT NULL, result_json jsonb, status text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS unity_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), host_ref text NOT NULL, status text NOT NULL, editor_version text NOT NULL, unity_cli_version text NOT NULL, pipeline_package_version text NOT NULL, capabilities text[] NOT NULL DEFAULT '{}', resource_profile jsonb NOT NULL, last_health_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS editor_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_ref text NOT NULL, tier text NOT NULL, status text NOT NULL, concurrency_limit integer NOT NULL CHECK (concurrency_limit > 0), expires_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS editor_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL UNIQUE REFERENCES runs(id), worker_id uuid NOT NULL REFERENCES unity_workers(id), license_id uuid NOT NULL REFERENCES editor_licenses(id), status text NOT NULL, acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, released_at timestamptz, activation_audit_ref text
);
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), type text NOT NULL, name text NOT NULL, source text NOT NULL, source_uri text, license_id text, license_text text, object_key text NOT NULL, content_hash text NOT NULL, media_type text NOT NULL, size_bytes bigint NOT NULL, width integer, height integer, metadata jsonb NOT NULL DEFAULT '{}', security_status text NOT NULL, import_status text NOT NULL, created_by_run_id uuid REFERENCES runs(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_usages (
  asset_id uuid NOT NULL REFERENCES assets(id), project_id uuid NOT NULL REFERENCES projects(id), logical_entity_id text NOT NULL, unity_asset_guid text, relative_path text NOT NULL, usage_kind text NOT NULL, introduced_spec_version_id uuid NOT NULL REFERENCES game_spec_versions(id), removed_spec_version_id uuid REFERENCES game_spec_versions(id), PRIMARY KEY (asset_id, logical_entity_id, relative_path)
);
CREATE TABLE IF NOT EXISTS playtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), project_id uuid NOT NULL REFERENCES projects(id), build_id uuid, mode text NOT NULL, seed bigint NOT NULL, fixed_delta_time_ms integer NOT NULL CHECK (fixed_delta_time_ms > 0), status text NOT NULL, action_plan jsonb NOT NULL, started_at timestamptz, finished_at timestamptz, environment_snapshot jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS playtest_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), playtest_run_id uuid NOT NULL REFERENCES playtest_runs(id), assertion_id text NOT NULL, kind text NOT NULL, sequence integer NOT NULL, timestamp_ms integer NOT NULL, summary text NOT NULL, object_key text, payload_json jsonb, content_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id), playtest_run_id uuid NOT NULL REFERENCES playtest_runs(id), game_spec_version_id uuid NOT NULL REFERENCES game_spec_versions(id), evaluator_version text NOT NULL, status text NOT NULL, passed_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0, inconclusive_count integer NOT NULL DEFAULT 0, report_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evaluation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), evaluation_report_id uuid NOT NULL REFERENCES evaluation_reports(id), issue_key text NOT NULL, assertion_id text NOT NULL, severity text NOT NULL, category text NOT NULL, description text NOT NULL, expected jsonb NOT NULL, actual jsonb NOT NULL, evidence_ids uuid[] NOT NULL DEFAULT '{}', affected_capabilities text[] NOT NULL, retryable boolean NOT NULL, resolution_status text NOT NULL DEFAULT 'open', resolved_by_run_id uuid REFERENCES runs(id), UNIQUE (evaluation_report_id, issue_key)
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), game_spec_version_id uuid NOT NULL REFERENCES game_spec_versions(id), source_run_id uuid NOT NULL REFERENCES runs(id), parent_checkpoint_id uuid REFERENCES checkpoints(id), commit_ref text NOT NULL, summary text NOT NULL, change_manifest jsonb NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), checkpoint_id uuid NOT NULL REFERENCES checkpoints(id), spec_version_id uuid NOT NULL REFERENCES game_spec_versions(id), target text NOT NULL CHECK (target = 'unity_web'), status text NOT NULL, engine_version text NOT NULL, adapter_version text NOT NULL, template_version text NOT NULL, package_lock_hash text NOT NULL, artifact_key text, content_hash text UNIQUE, size_bytes bigint, evaluation_report_id uuid REFERENCES evaluation_reports(id), build_log_key text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id), build_id uuid NOT NULL REFERENCES builds(id), status text NOT NULL, public_slug text NOT NULL, origin text NOT NULL, health_checked_at timestamptz, published_at timestamptz, expires_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_preview_per_project ON previews(project_id) WHERE status IN ('provisioning', 'healthy');
CREATE INDEX IF NOT EXISTS tasks_capabilities_idx ON tasks USING gin(capabilities);
CREATE INDEX IF NOT EXISTS evaluation_capabilities_idx ON evaluation_issues USING gin(affected_capabilities);
