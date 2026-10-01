ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS span_id text;

UPDATE run_events AS event
SET trace_id = run.trace_id
FROM runs AS run
WHERE event.run_id = run.id
  AND event.trace_id IS NULL;

UPDATE run_events
SET span_id = substring(
  encode(digest(run_id::text || ':' || sequence::text, 'sha256'), 'hex'),
  1,
  16
)
WHERE span_id IS NULL;

UPDATE event_outbox AS outbox
SET trace_id = event.trace_id,
    span_id = event.span_id
FROM run_events AS event
WHERE outbox.run_id = event.run_id
  AND outbox.sequence = event.sequence
  AND (outbox.trace_id IS NULL OR outbox.span_id IS NULL);

ALTER TABLE run_events
  ALTER COLUMN trace_id SET NOT NULL,
  ALTER COLUMN span_id SET NOT NULL;

ALTER TABLE event_outbox
  ALTER COLUMN trace_id SET NOT NULL,
  ALTER COLUMN span_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'run_events_trace_format'
  ) THEN
    ALTER TABLE run_events
      ADD CONSTRAINT run_events_trace_format
      CHECK (trace_id ~ '^[0-9a-f]{32}$' AND span_id ~ '^[0-9a-f]{16}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_outbox_trace_format'
  ) THEN
    ALTER TABLE event_outbox
      ADD CONSTRAINT event_outbox_trace_format
      CHECK (trace_id ~ '^[0-9a-f]{32}$' AND span_id ~ '^[0-9a-f]{16}$');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS event_outbox_trace_id_idx
  ON event_outbox(trace_id, created_at);
