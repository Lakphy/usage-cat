import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import {
  integrationInputSchema,
  integrationOrderSchema,
  integrationUpdateSchema,
  providerSchema,
} from "@/shared/usage";
import { normalizeCredential, type StoredCredential } from "@/worker/adapters";
import { requireAdmin } from "@/worker/auth";
import { encryptCredential } from "@/worker/crypto";
import type { AppVariables, Env } from "@/worker/env";
import { AdapterError } from "@/worker/errors";
import { MAX_ENABLED_INTEGRATIONS, MAX_SCHEDULED_SYNCS_PER_DAY } from "@/worker/limits";
import { enqueueSync } from "@/worker/sync";

interface IntegrationRow {
  id: string;
  provider: string;
  display_name: string;
  public_identity: string | null;
  plan_name: string | null;
  status: string;
  enabled: number;
  interval_minutes: number;
  next_sync_at: number;
  last_synced_at: number | null;
  last_error_code: string | null;
  sort_order: number;
  created_at: number;
  has_credential: number;
}

function serialize(row: IntegrationRow) {
  return {
    id: row.id,
    provider: providerSchema.parse(row.provider),
    displayName: row.display_name,
    publicIdentity: row.public_identity ?? undefined,
    plan: row.plan_name ?? undefined,
    status: row.status,
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    nextSyncAt: row.next_sync_at,
    lastSyncedAt: row.last_synced_at ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    hasCredential: row.has_credential === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

async function enabledCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM integrations WHERE enabled = 1 AND archived_at IS NULL",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

async function scheduledSyncsPerDay(env: Env, excludedId?: string): Promise<number> {
  const statement = excludedId
    ? env.DB.prepare(
        `SELECT COALESCE(SUM(1440.0 / interval_minutes), 0) AS count
         FROM integrations
         WHERE enabled = 1 AND archived_at IS NULL AND id != ?`,
      ).bind(excludedId)
    : env.DB.prepare(
        `SELECT COALESCE(SUM(1440.0 / interval_minutes), 0) AS count
         FROM integrations WHERE enabled = 1 AND archived_at IS NULL`,
      );
  const row = await statement.first<{ count: number }>();
  return row?.count ?? 0;
}

function syncBudgetExceeded(total: number): boolean {
  return total > MAX_SCHEDULED_SYNCS_PER_DAY + 0.000001;
}

function syncBudgetResponse(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  proposedTotal?: number,
) {
  const proposed =
    proposedTotal === undefined ? "" : `（当前配置约 ${Math.ceil(proposedTotal)} 次/天）`;
  return c.json(
    {
      error: {
        code: "SYNC_BUDGET_EXCEEDED",
        message: `计划同步总量超过免费套餐保护上限 ${MAX_SCHEDULED_SYNCS_PER_DAY} 次/天${proposed}，请调大刷新周期`,
      },
    },
    409,
  );
}

function isSyncBudgetDatabaseError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SYNC_BUDGET_EXCEEDED");
}

function newCredentialVersion(): number {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return 2 + (random % 2_147_483_645);
}

export const adminRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
adminRoutes.use("*", requireAdmin);

adminRoutes.get("/session", (c) => c.json({ data: c.get("session") }));

adminRoutes.get("/integrations", async (c) => {
  const [result, dailySyncs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT i.*, CASE WHEN cs.integration_id IS NULL THEN 0 ELSE 1 END AS has_credential
       FROM integrations i LEFT JOIN credential_secrets cs ON cs.integration_id = i.id
       WHERE i.archived_at IS NULL
       ORDER BY i.sort_order ASC, i.created_at ASC, i.id ASC`,
    ).all<IntegrationRow>(),
    scheduledSyncsPerDay(c.env),
  ]);
  c.header("Cache-Control", "no-store");
  return c.json({
    data: result.results.map(serialize),
    limits: {
      enabled: MAX_ENABLED_INTEGRATIONS,
      scheduledSyncsPerDay: MAX_SCHEDULED_SYNCS_PER_DAY,
      scheduledSyncsPerDayUsed: Math.ceil(dailySyncs),
    },
  });
});

adminRoutes.post("/integrations/reorder", zValidator("json", integrationOrderSchema), async (c) => {
  const { orderedIds } = c.req.valid("json");
  const current = await c.env.DB.prepare(
    `SELECT id FROM integrations WHERE archived_at IS NULL
     ORDER BY sort_order ASC, created_at ASC, id ASC`,
  ).all<{ id: string }>();
  const currentIds = current.results.map((row) => row.id);
  const currentSet = new Set(currentIds);
  const sameSet =
    currentIds.length === orderedIds.length && orderedIds.every((id) => currentSet.has(id));
  if (!sameSet) {
    return c.json(
      {
        error: {
          code: "ORDER_STALE",
          message: "监控项列表已变化，请刷新后重新排序",
        },
      },
      409,
    );
  }

  if (orderedIds.every((id, index) => id === currentIds[index])) {
    return c.json({ ok: true });
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch(
    orderedIds.map((id, index) =>
      c.env.DB.prepare(
        "UPDATE integrations SET sort_order = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      ).bind((index + 1) * 100, now, id),
    ),
  );
  return c.json({ ok: true });
});

adminRoutes.post("/integrations", zValidator("json", integrationInputSchema), async (c) => {
  const body = c.req.valid("json");
  if (body.enabled && (await enabledCount(c.env)) >= MAX_ENABLED_INTEGRATIONS) {
    return c.json(
      {
        error: {
          code: "LIMIT_REACHED",
          message: `最多启用 ${MAX_ENABLED_INTEGRATIONS} 个监控项`,
        },
      },
      409,
    );
  }
  const proposedDailySyncs =
    (body.enabled ? 1440 / body.intervalMinutes : 0) + (await scheduledSyncsPerDay(c.env));
  if (body.enabled && syncBudgetExceeded(proposedDailySyncs)) {
    return syncBudgetResponse(c, proposedDailySyncs);
  }
  let normalized: StoredCredential;
  try {
    normalized = normalizeCredential(body.provider, body.credential, body.credentialMode);
  } catch (error) {
    if (error instanceof AdapterError) {
      return c.json({ error: { code: error.code, message: error.message } }, 400);
    }
    throw error;
  }
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const aad = `${id}:${body.provider}:1`;
  const encrypted = await encryptCredential(normalized, c.env.CREDENTIAL_ENCRYPTION_KEY, aad);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO integrations
          (id, provider, display_name, status, enabled, interval_minutes, next_sync_at,
           sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?,
           COALESCE((SELECT MAX(sort_order) + 100 FROM integrations WHERE archived_at IS NULL), 0),
           ?, ?)`,
      ).bind(
        id,
        body.provider,
        body.displayName,
        body.enabled ? 1 : 0,
        body.intervalMinutes,
        now,
        now,
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO credential_secrets
          (integration_id, encrypted_payload, nonce, key_version, updated_at) VALUES (?, ?, ?, 1, ?)`,
      ).bind(id, encrypted.encryptedPayload, encrypted.nonce, now),
    ]);
  } catch (error) {
    if (isSyncBudgetDatabaseError(error)) return syncBudgetResponse(c);
    throw error;
  }
  const runId = await enqueueSync(c.env, id, "verify", now);
  return c.json({ data: { id, runId } }, 201);
});

adminRoutes.patch("/integrations/:id", zValidator("json", integrationUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const current = await c.env.DB.prepare(
    `SELECT provider, enabled, interval_minutes
     FROM integrations WHERE id = ? AND archived_at IS NULL`,
  )
    .bind(id)
    .first<{ provider: string; enabled: number; interval_minutes: number }>();
  if (!current) return c.json({ error: { code: "NOT_FOUND", message: "监控项不存在" } }, 404);
  if (
    body.enabled === true &&
    current.enabled === 0 &&
    (await enabledCount(c.env)) >= MAX_ENABLED_INTEGRATIONS
  ) {
    return c.json(
      {
        error: {
          code: "LIMIT_REACHED",
          message: `最多启用 ${MAX_ENABLED_INTEGRATIONS} 个监控项`,
        },
      },
      409,
    );
  }
  if (body.enabled !== undefined || body.intervalMinutes !== undefined) {
    const currentTotal = await scheduledSyncsPerDay(c.env);
    const effectiveEnabled = body.enabled ?? current.enabled === 1;
    const effectiveInterval = body.intervalMinutes ?? current.interval_minutes;
    const proposedTotal =
      (await scheduledSyncsPerDay(c.env, id)) + (effectiveEnabled ? 1440 / effectiveInterval : 0);
    if (syncBudgetExceeded(proposedTotal) && proposedTotal > currentTotal + 0.000001) {
      return syncBudgetResponse(c, proposedTotal);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  let credentialStatement: D1PreparedStatement | undefined;
  if (body.credential) {
    let normalized: StoredCredential;
    try {
      normalized = normalizeCredential(
        providerSchema.parse(current.provider),
        body.credential,
        body.credentialMode,
      );
    } catch (error) {
      if (error instanceof AdapterError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      throw error;
    }
    // A random generation prevents an in-flight refresh from overwriting a credential that an
    // administrator replaced concurrently. It need not be sequential; it only needs to change.
    const credentialVersion = newCredentialVersion();
    const aad = `${id}:${current.provider}:${credentialVersion}`;
    const encrypted = await encryptCredential(normalized, c.env.CREDENTIAL_ENCRYPTION_KEY, aad);
    credentialStatement = c.env.DB.prepare(
      `INSERT INTO credential_secrets (integration_id, encrypted_payload, nonce, key_version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(integration_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload,
         nonce = excluded.nonce, key_version = excluded.key_version,
         updated_at = excluded.updated_at`,
    ).bind(id, encrypted.encryptedPayload, encrypted.nonce, credentialVersion, now);
  }

  const statements = [
    c.env.DB.prepare(
      `UPDATE integrations SET
         display_name = COALESCE(?, display_name),
         interval_minutes = COALESCE(?, interval_minutes),
         enabled = COALESCE(?, enabled),
         status = CASE WHEN ? = 1 THEN 'pending' ELSE status END,
         next_sync_at = CASE WHEN ? IS NOT NULL OR ? = 1 OR ? = 1 THEN ? ELSE next_sync_at END,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      body.displayName ?? null,
      body.intervalMinutes ?? null,
      body.enabled === undefined ? null : body.enabled ? 1 : 0,
      body.credential ? 1 : 0,
      body.intervalMinutes ?? null,
      body.enabled === true ? 1 : 0,
      body.credential ? 1 : 0,
      now,
      now,
      id,
    ),
  ];
  if (credentialStatement) statements.push(credentialStatement);
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (isSyncBudgetDatabaseError(error)) return syncBudgetResponse(c);
    throw error;
  }

  let runId: string | undefined;
  if (body.credential) {
    runId = await enqueueSync(c.env, id, "verify", now);
  }
  return c.json({ data: { id, runId } });
});

adminRoutes.delete("/integrations/:id", async (c) => {
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE integrations SET status = 'archived', enabled = 0, archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL`,
    ).bind(now, now, id),
    c.env.DB.prepare("DELETE FROM credential_secrets WHERE integration_id = ?").bind(id),
  ]);
  if ((result[0].meta.changes ?? 0) !== 1) {
    return c.json({ error: { code: "NOT_FOUND", message: "监控项不存在" } }, 404);
  }
  return c.json({ ok: true, retainedSnapshotsDays: 365 });
});

adminRoutes.post("/integrations/:id/sync", async (c) => {
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  const integration = await c.env.DB.prepare(
    "SELECT id FROM integrations WHERE id = ? AND archived_at IS NULL",
  )
    .bind(id)
    .first();
  if (!integration) return c.json({ error: { code: "NOT_FOUND", message: "监控项不存在" } }, 404);
  const recent = await c.env.DB.prepare(
    `SELECT id FROM sync_runs WHERE integration_id = ? AND trigger_type = 'manual'
     AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(id, now - 30)
    .first();
  if (recent)
    return c.json({ error: { code: "RATE_LIMITED", message: "手动同步间隔为 30 秒" } }, 429);
  return c.json({ data: { runId: await enqueueSync(c.env, id, "manual", now) } }, 202);
});

adminRoutes.get("/sync-runs", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT r.id, r.integration_id, i.display_name, r.trigger_type, r.status, r.scheduled_at,
            r.started_at, r.finished_at, r.attempt, r.error_code, r.error_message
     FROM sync_runs r JOIN integrations i ON i.id = r.integration_id
     ORDER BY r.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ data: result.results });
});
