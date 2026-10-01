CREATE UNIQUE INDEX IF NOT EXISTS previews_project_build_unique
  ON previews(project_id, build_id);
