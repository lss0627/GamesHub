-- Tenant isolation is enforced at the database boundary as well as in repositories.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_spec_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE playtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE playtest_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE previews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id);

-- The API transaction must set app.current_user_id before project-scoped access.
DROP POLICY IF EXISTS projects_owner_policy ON projects;
CREATE POLICY projects_owner_policy ON projects
  FOR ALL
  USING (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
DROP POLICY IF EXISTS runs_owner_policy ON runs;
CREATE POLICY runs_owner_policy ON runs
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS assets_owner_policy ON assets;
CREATE POLICY assets_owner_policy ON assets
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));

DROP POLICY IF EXISTS agent_sessions_owner_policy ON agent_sessions;
CREATE POLICY agent_sessions_owner_policy ON agent_sessions
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS specs_owner_policy ON game_spec_versions;
CREATE POLICY specs_owner_policy ON game_spec_versions
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS task_graphs_owner_policy ON task_graphs;
CREATE POLICY task_graphs_owner_policy ON task_graphs
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS tasks_owner_policy ON tasks;
CREATE POLICY tasks_owner_policy ON tasks
  FOR ALL USING (task_graph_id IN (SELECT id FROM task_graphs))
  WITH CHECK (task_graph_id IN (SELECT id FROM task_graphs));
DROP POLICY IF EXISTS task_dependencies_owner_policy ON task_dependencies;
CREATE POLICY task_dependencies_owner_policy ON task_dependencies
  FOR ALL USING (task_graph_id IN (SELECT id FROM task_graphs))
  WITH CHECK (task_graph_id IN (SELECT id FROM task_graphs));
DROP POLICY IF EXISTS run_events_owner_policy ON run_events;
CREATE POLICY run_events_owner_policy ON run_events
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS model_calls_owner_policy ON model_calls;
CREATE POLICY model_calls_owner_policy ON model_calls
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS tool_invocations_owner_policy ON tool_invocations;
CREATE POLICY tool_invocations_owner_policy ON tool_invocations
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS skill_invocations_owner_policy ON skill_invocations;
CREATE POLICY skill_invocations_owner_policy ON skill_invocations
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS editor_leases_owner_policy ON editor_leases;
CREATE POLICY editor_leases_owner_policy ON editor_leases
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS checkpoints_owner_policy ON checkpoints;
CREATE POLICY checkpoints_owner_policy ON checkpoints
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS asset_usages_owner_policy ON asset_usages;
CREATE POLICY asset_usages_owner_policy ON asset_usages
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS playtest_runs_owner_policy ON playtest_runs;
CREATE POLICY playtest_runs_owner_policy ON playtest_runs
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
DROP POLICY IF EXISTS playtest_evidence_owner_policy ON playtest_evidence;
CREATE POLICY playtest_evidence_owner_policy ON playtest_evidence
  FOR ALL USING (playtest_run_id IN (SELECT id FROM playtest_runs))
  WITH CHECK (playtest_run_id IN (SELECT id FROM playtest_runs));
DROP POLICY IF EXISTS evaluation_reports_owner_policy ON evaluation_reports;
CREATE POLICY evaluation_reports_owner_policy ON evaluation_reports
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
DROP POLICY IF EXISTS evaluation_issues_owner_policy ON evaluation_issues;
CREATE POLICY evaluation_issues_owner_policy ON evaluation_issues
  FOR ALL USING (evaluation_report_id IN (SELECT id FROM evaluation_reports))
  WITH CHECK (evaluation_report_id IN (SELECT id FROM evaluation_reports));
DROP POLICY IF EXISTS previews_owner_policy ON previews;
CREATE POLICY previews_owner_policy ON previews
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
