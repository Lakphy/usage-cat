-- Prevent the five-minute recovery job from scanning all retained sync runs.
CREATE INDEX sync_runs_running_lease_idx
ON sync_runs (lease_expires_at)
WHERE status = 'running';

-- A failed Browser Rendering fallback is held for an hour so repeated Kimi syncs do not
-- exhaust Browser Rendering Free usage during an upstream challenge incident.
ALTER TABLE integrations ADD COLUMN browser_fallback_disabled_until INTEGER;

-- Only migrate the old recommended values. Explicitly customized intervals are preserved.
UPDATE integrations
SET interval_minutes = CASE provider
    WHEN 'codex' THEN 15
    WHEN 'kimi' THEN 15
    WHEN 'zenmux' THEN 30
    ELSE interval_minutes
  END,
  updated_at = unixepoch()
WHERE archived_at IS NULL
  AND (
    (provider = 'codex' AND interval_minutes = 10) OR
    (provider = 'kimi' AND interval_minutes = 10) OR
    (provider = 'zenmux' AND interval_minutes = 10)
  );
