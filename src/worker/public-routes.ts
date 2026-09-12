import { Hono } from "hono";
import { type PublicIntegration, providerSchema, snapshotPayloadSchema } from "@/shared/usage";
import type { Env } from "@/worker/env";

interface DashboardRow {
  id: string;
  provider: string;
  display_name: string;
  public_identity: string | null;
  plan_name: string | null;
  status: PublicIntegration["status"];
  enabled: number;
  interval_minutes: number;
  last_synced_at: number | null;
  payload_json: string | null;
}

function parseSnapshot(raw: string | null) {
  if (!raw) return undefined;
  try {
    const parsed = snapshotPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get("/dashboard", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT i.id, i.provider, i.display_name, i.public_identity, i.plan_name, i.status,
            i.enabled, i.interval_minutes, i.last_synced_at, s.payload_json
     FROM integrations i
     LEFT JOIN usage_snapshots s ON s.id = (
       SELECT id FROM usage_snapshots WHERE integration_id = i.id
       ORDER BY captured_at DESC, id DESC LIMIT 1
     )
     WHERE i.archived_at IS NULL
     ORDER BY i.sort_order ASC, i.created_at ASC, i.id ASC`,
  ).all<DashboardRow>();
  const integrations: PublicIntegration[] = result.results.map((row) => {
    const snapshot = parseSnapshot(row.payload_json);
    return {
      id: row.id,
      provider: providerSchema.parse(row.provider),
      displayName: row.display_name,
      publicIdentity: row.public_identity ?? undefined,
      plan: row.plan_name ?? undefined,
      status: row.status,
      enabled: row.enabled === 1,
      intervalMinutes: row.interval_minutes,
      lastSyncedAt: row.last_synced_at ?? undefined,
      metrics: snapshot?.metrics ?? [],
    };
  });
  c.header("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
  return c.json({ data: integrations, generatedAt: Math.floor(Date.now() / 1000) });
});

publicRoutes.get("/integrations/:id/history", async (c) => {
  const id = c.req.param("id");
  const metric = c.req.query("metric")?.slice(0, 100);
  if (!metric) return c.json({ error: { code: "BAD_REQUEST", message: "缺少 metric" } }, 400);
  const now = Math.floor(Date.now() / 1000);
  const requestedFrom = Number(c.req.query("from")) || now - 7 * 86_400;
  const requestedTo = Number(c.req.query("to")) || now;
  const to = Math.min(now + 300, requestedTo);
  const from = Math.max(to - 365 * 86_400, Math.min(requestedFrom, to));
  const span = Math.max(1, to - from);
  const bucketSeconds = span <= 7 * 86_400 ? 1 : Math.max(60, Math.ceil(span / 600));
  const envelope = c.req.query("sampling") === "envelope";
  const exists = await c.env.DB.prepare(
    "SELECT id FROM integrations WHERE id = ? AND archived_at IS NULL",
  )
    .bind(id)
    .first();
  if (!exists) return c.json({ error: { code: "NOT_FOUND", message: "监控项不存在" } }, 404);

  const result = await c.env.DB.prepare(
    `WITH metric_rows AS (
       SELECT u.captured_at, je.value AS metric_json,
              CAST(u.captured_at / ? AS INTEGER) AS bucket,
              json_extract(je.value, '$.kind') AS metric_kind,
              CASE WHEN json_extract(je.value, '$.kind') = 'quota_window' OR (
                CAST(json_extract(je.value, '$.limit') AS REAL) > 0 AND
                (json_extract(je.value, '$.remaining') IS NOT NULL OR
                 json_extract(je.value, '$.used') IS NOT NULL)
              ) THEN 1 ELSE 0 END AS remaining_semantics,
              CASE WHEN json_extract(je.value, '$.kind') = 'quota_window' OR (
                CAST(json_extract(je.value, '$.limit') AS REAL) > 0 AND
                (json_extract(je.value, '$.remaining') IS NOT NULL OR
                 json_extract(je.value, '$.used') IS NOT NULL)
              ) THEN
                COALESCE(
                  CAST(json_extract(je.value, '$.remaining') AS REAL),
                  CAST(json_extract(je.value, '$.limit') AS REAL) -
                    CAST(json_extract(je.value, '$.used') AS REAL),
                  100.0 - CAST(json_extract(je.value, '$.percentage') AS REAL)
                )
              ELSE COALESCE(
                  CAST(json_extract(je.value, '$.percentage') AS REAL),
                  CAST(json_extract(je.value, '$.used') AS REAL),
                  CAST(json_extract(je.value, '$.value') AS REAL)
                )
              END AS chart_value
       FROM usage_snapshots u, json_each(u.payload_json, '$.metrics') je
       WHERE u.integration_id = ? AND u.captured_at BETWEEN ? AND ?
         AND json_extract(je.value, '$.key') = ?
     ), ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY captured_at DESC) AS latest_rank,
         ROW_NUMBER() OVER (
           PARTITION BY bucket
           ORDER BY CASE WHEN remaining_semantics = 1 THEN -chart_value ELSE chart_value END DESC,
                    captured_at DESC
         ) AS envelope_rank
       FROM metric_rows
     )
     SELECT captured_at, metric_json FROM ranked
     WHERE latest_rank = 1 OR (? = 1 AND envelope_rank = 1)
     ORDER BY captured_at ASC`,
  )
    .bind(bucketSeconds, id, from, to, metric, envelope ? 1 : 0)
    .all<{ captured_at: number; metric_json: string }>();
  const points = result.results.flatMap((row) => {
    try {
      return [{ capturedAt: row.captured_at, metric: JSON.parse(row.metric_json) }];
    } catch {
      return [];
    }
  });
  c.header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return c.json({ data: points, metric, from, to, bucketSeconds });
});

publicRoutes.get("/integrations/:id/snapshots", async (c) => {
  const id = c.req.param("id");
  const rawCursor = c.req.query("cursor");
  let cursorTime = Number.MAX_SAFE_INTEGER;
  let cursorId = "\uffff";
  if (rawCursor) {
    try {
      const unpadded = rawCursor.replaceAll("-", "+").replaceAll("_", "/");
      const normalized = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");
      const parsed = JSON.parse(atob(normalized)) as unknown;
      if (
        Array.isArray(parsed) &&
        typeof parsed[0] === "number" &&
        Number.isSafeInteger(parsed[0]) &&
        typeof parsed[1] === "string"
      ) {
        [cursorTime, cursorId] = parsed;
      }
    } catch {
      const legacy = Number(rawCursor);
      if (Number.isSafeInteger(legacy)) {
        cursorTime = legacy;
        cursorId = "";
      }
    }
  }
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 30));
  const result = await c.env.DB.prepare(
    `SELECT id, captured_at, payload_json FROM usage_snapshots
     WHERE integration_id = ?
       AND (captured_at < ? OR (captured_at = ? AND id < ?))
     ORDER BY captured_at DESC, id DESC LIMIT ?`,
  )
    .bind(id, cursorTime, cursorTime, cursorId, limit + 1)
    .all<{ id: string; captured_at: number; payload_json: string }>();
  const hasMore = result.results.length > limit;
  const page = result.results.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? btoa(JSON.stringify([last.captured_at, last.id]))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "")
      : undefined;
  return c.json({
    data: page.map((row) => ({
      id: row.id,
      capturedAt: row.captured_at,
      payload: parseSnapshot(row.payload_json),
    })),
    nextCursor,
  });
});
