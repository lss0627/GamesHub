CREATE TABLE project_designs (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_designs ENABLE ROW LEVEL SECURITY;
CREATE POLICY designs_owner_policy ON project_designs
  FOR ALL USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
