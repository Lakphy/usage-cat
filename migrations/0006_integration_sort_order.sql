ALTER TABLE integrations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing created-at order. Subsequent reorders normalize values to small gaps.
UPDATE integrations
SET sort_order = created_at
WHERE archived_at IS NULL;

CREATE INDEX integrations_display_order_idx
ON integrations (sort_order, created_at, id)
WHERE archived_at IS NULL;
