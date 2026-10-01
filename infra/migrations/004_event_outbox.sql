-- Transactional outbox for durable worker/event delivery.
CREATE TABLE IF NOT EXISTS event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
  ON event_outbox (status, available_at, created_at)
  WHERE status = 'pending';

ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_outbox_owner_policy ON event_outbox;
CREATE POLICY event_outbox_owner_policy ON event_outbox
  FOR ALL USING (run_id IN (SELECT id FROM runs))
  WITH CHECK (run_id IN (SELECT id FROM runs));
