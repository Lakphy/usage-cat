-- Bring pre-existing installations under the free-tier scheduling budget before enforcing it.
-- With N enabled integrations, raising every interval to CEIL(N * 1440 / 300) is sufficient.
UPDATE integrations
SET interval_minutes = MAX(
  interval_minutes,
  CAST(((
    SELECT COUNT(*) FROM integrations WHERE enabled = 1 AND archived_at IS NULL
  ) * 1440 + 299) / 300 AS INTEGER)
)
WHERE enabled = 1 AND archived_at IS NULL;

CREATE TRIGGER integrations_sync_budget_insert
BEFORE INSERT ON integrations
WHEN NEW.enabled = 1
  AND NEW.archived_at IS NULL
  AND COALESCE((
    SELECT SUM(1440.0 / interval_minutes)
    FROM integrations
    WHERE enabled = 1 AND archived_at IS NULL
  ), 0) + (1440.0 / NEW.interval_minutes) > 300.000001
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
  ), 0) + (1440.0 / NEW.interval_minutes) > 300.000001
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
