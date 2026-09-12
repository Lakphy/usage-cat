ALTER TABLE sync_runs ADD COLUMN lease_token TEXT;
ALTER TABLE sync_runs ADD COLUMN dedupe_key TEXT;
ALTER TABLE sync_runs ADD COLUMN enqueued_at INTEGER;

CREATE INDEX sync_runs_queued_idx ON sync_runs (status, scheduled_at)
  WHERE status = 'queued';

CREATE UNIQUE INDEX sync_runs_dedupe_idx ON sync_runs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE sync_outbox (
  run_id TEXT PRIMARY KEY REFERENCES sync_runs(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX sync_outbox_available_idx ON sync_outbox (available_at, created_at);
