ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS trace_id text;

UPDATE runs
SET trace_id = replace(id::text, '-', '')
WHERE trace_id IS NULL;

ALTER TABLE runs
  ALTER COLUMN trace_id SET DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ALTER COLUMN trace_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runs_trace_id_format'
  ) THEN
    ALTER TABLE runs
      ADD CONSTRAINT runs_trace_id_format
      CHECK (trace_id ~ '^[0-9a-f]{32}$');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS runs_trace_id_idx ON runs(trace_id);
CREATE INDEX IF NOT EXISTS run_events_trace_id_idx
  ON run_events(trace_id, occurred_at)
  WHERE trace_id IS NOT NULL;
