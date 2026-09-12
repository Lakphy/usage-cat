-- 1,000 scheduled messages/day stays within Queues Free's 10,000 daily operations:
-- normal delivery costs about 3 operations/message; five configured retries bring the
-- theoretical maximum to about 8,000, leaving headroom for verification and manual syncs.
DROP TRIGGER IF EXISTS integrations_sync_budget_insert;
DROP TRIGGER IF EXISTS integrations_sync_budget_update;

CREATE TRIGGER integrations_sync_budget_insert
BEFORE INSERT ON integrations
WHEN NEW.enabled = 1
  AND NEW.archived_at IS NULL
  AND COALESCE((
    SELECT SUM(1440.0 / interval_minutes)
    FROM integrations
    WHERE enabled = 1 AND archived_at IS NULL
  ), 0) + (1440.0 / NEW.interval_minutes) > 1000.000001
BEGIN
  SELECT RAISE(ABORT, 'SYNC_BUDGET_EXCEEDED');
END;

CREATE TRIGGER integrations_sync_budget_update
BEFORE UPDATE OF enabled, interval_minutes, archived_at ON integrations
WHEN NEW.enabled = 1
  AND NEW.archived_at IS NULL
  AND COALESCE((
    SELECT SUM(1440.0 / interval_minutes)
    FROM integrations
    WHERE enabled = 1 AND archived_at IS NULL AND id != OLD.id
  ), 0) + (1440.0 / NEW.interval_minutes) > 1000.000001
  AND COALESCE((
    SELECT SUM(1440.0 / interval_minutes)
    FROM integrations
    WHERE enabled = 1 AND archived_at IS NULL AND id != OLD.id
  ), 0) + (1440.0 / NEW.interval_minutes)
    > COALESCE((
      SELECT SUM(1440.0 / interval_minutes)
      FROM integrations
      WHERE enabled = 1 AND archived_at IS NULL
    ), 0) + 0.000001
BEGIN
  SELECT RAISE(ABORT, 'SYNC_BUDGET_EXCEEDED');
END;
