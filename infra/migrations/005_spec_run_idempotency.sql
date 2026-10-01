CREATE UNIQUE INDEX IF NOT EXISTS game_spec_source_run_unique
  ON game_spec_versions(project_id, source_run_id);
