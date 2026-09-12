PRAGMA foreign_keys = ON;

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'cursor', 'grok', 'zenmux', 'kimi')),
  display_name TEXT NOT NULL,
  public_identity TEXT,
  plan_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'healthy', 'action_required', 'archived')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (interval_minutes BETWEEN 5 AND 1440),
  next_sync_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX integrations_due_idx ON integrations (enabled, status, next_sync_at)
  WHERE archived_at IS NULL;

CREATE TABLE credential_secrets (
  integration_id TEXT PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule', 'manual', 'verify')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX sync_runs_integration_idx ON sync_runs (integration_id, created_at DESC);

CREATE TABLE usage_snapshots (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  sync_run_id TEXT NOT NULL UNIQUE REFERENCES sync_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL
);

CREATE INDEX snapshots_history_idx ON usage_snapshots (integration_id, captured_at DESC);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_avatar_url TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at);
