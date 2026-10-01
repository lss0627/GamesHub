CREATE TABLE project_art_plans (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_art_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY art_plans_owner_policy ON project_art_plans
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
