CREATE TABLE project_agent_memory (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL DEFAULT '{"items":[]}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_checkpoints (
  run_id uuid PRIMARY KEY REFERENCES runs(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  revision bigint NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL,
  content_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_memory_owner ON project_agent_memory FOR ALL
  USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
ALTER TABLE agent_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_checkpoints_owner ON agent_checkpoints FOR ALL
  USING (project_id IN (SELECT id FROM projects))
  WITH CHECK (project_id IN (SELECT id FROM projects));
