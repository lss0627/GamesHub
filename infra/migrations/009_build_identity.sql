-- Identical bytes can belong to different projects, specifications and runs.
-- Keep retry idempotency within a checkpoint without mutating another build.
ALTER TABLE builds DROP CONSTRAINT IF EXISTS builds_content_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS builds_execution_content_unique
  ON builds (project_id, checkpoint_id, spec_version_id, content_hash);
