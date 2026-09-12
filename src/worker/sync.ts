import type { ProviderId, SyncMessage } from "@/shared/usage";
import { adapters } from "@/worker/adapters";
import type { CollectResult, StoredCredential } from "@/worker/adapters/types";
import { decryptCredential, encryptCredential } from "@/worker/crypto";
import type { Env } from "@/worker/env";
import { safeError } from "@/worker/errors";
import { RAW_SNAPSHOT_RETENTION_DAYS, SNAPSHOT_RETENTION_DAYS } from "@/worker/limits";

type SyncTrigger = "manual" | "verify" | "schedule";

interface SyncRow {
  run_id: string;
  integration_id: string;
  provider: ProviderId;
  attempt: number;
  encrypted_payload: string;
  nonce: string;
  key_version: number;
  browser_fallback_disabled_until: number | null;
}

interface OutboxRow {
  run_id: string;
  integration_id: string;
  attempts: number;
}

export interface ProcessResult {
  outcome: "done" | "retry";
  retryAfterSeconds?: number;
}

async function createQueuedRun(
  env: Env,
  integrationId: string,
  trigger: SyncTrigger,
  now: number,
  dedupeKey?: string,
): Promise<string> {
  const runId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_runs
          (id, integration_id, trigger_type, status, scheduled_at, created_at, dedupe_key)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      ).bind(runId, integrationId, trigger, now, now, dedupeKey ?? null),
      env.DB.prepare(
        `INSERT INTO sync_outbox
          (run_id, integration_id, available_at, attempts, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      ).bind(runId, integrationId, now, now),
    ]);
    return runId;
  } catch (error) {
    if (!dedupeKey) throw error;
    const existing = await env.DB.prepare("SELECT id FROM sync_runs WHERE dedupe_key = ?")
      .bind(dedupeKey)
      .first<{ id: string }>();
    if (!existing) throw error;
    return existing.id;
  }
}

export async function flushSyncOutbox(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  onlyRunId?: string,
) {
  const result = await env.DB.prepare(
    `SELECT run_id, integration_id, attempts FROM sync_outbox
     WHERE available_at <= ? AND (? IS NULL OR run_id = ?)
     ORDER BY created_at ASC LIMIT 20`,
  )
    .bind(now, onlyRunId ?? null, onlyRunId ?? null)
    .all<OutboxRow>();

  for (const row of result.results) {
    try {
      await env.SYNC_QUEUE.send({ integrationId: row.integration_id, runId: row.run_id });
      await env.DB.batch([
        env.DB.prepare("UPDATE sync_runs SET enqueued_at = ? WHERE id = ?").bind(now, row.run_id),
        env.DB.prepare("DELETE FROM sync_outbox WHERE run_id = ?").bind(row.run_id),
      ]);
    } catch {
      const delay = Math.min(900, 15 * 2 ** Math.min(6, row.attempts));
      await env.DB.prepare(
        `UPDATE sync_outbox SET attempts = attempts + 1, available_at = ?, last_error = ?
         WHERE run_id = ?`,
      )
        .bind(now + delay, "QUEUE_SEND_FAILED", row.run_id)
        .run();
    }
  }
}

export async function enqueueSync(
  env: Env,
  integrationId: string,
  trigger: SyncTrigger,
  now = Math.floor(Date.now() / 1000),
  dedupeKey?: string,
): Promise<string> {
  const runId = await createQueuedRun(env, integrationId, trigger, now, dedupeKey);
  await flushSyncOutbox(env, now, runId);
  return runId;
}

async function recoverStaleRuns(env: Env, now: number) {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sync_runs SET status = 'queued', lease_expires_at = NULL, lease_token = NULL
       WHERE status = 'running' AND lease_expires_at < ?`,
    ).bind(now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO sync_outbox
        (run_id, integration_id, available_at, attempts, created_at)
       SELECT id, integration_id, ?, 0, ? FROM sync_runs
       WHERE status = 'queued' AND COALESCE(enqueued_at, 0) < ?`,
    ).bind(now, now, now - 300),
  ]);
}

export async function scheduleDueIntegrations(env: Env, now = Math.floor(Date.now() / 1000)) {
  await recoverStaleRuns(env, now);
  await flushSyncOutbox(env, now);

  const due = await env.DB.prepare(
    `SELECT id, interval_minutes, next_sync_at FROM integrations
     WHERE enabled = 1 AND archived_at IS NULL AND status != 'archived' AND next_sync_at <= ?
     ORDER BY next_sync_at ASC LIMIT 10`,
  )
    .bind(now)
    .all<{ id: string; interval_minutes: number; next_sync_at: number }>();

  for (const integration of due.results) {
    const scheduledAt = integration.next_sync_at;
    await enqueueSync(
      env,
      integration.id,
      "schedule",
      now,
      `schedule:${integration.id}:${scheduledAt}`,
    );
    await env.DB.prepare(
      `UPDATE integrations SET next_sync_at = ?, updated_at = ?
       WHERE id = ? AND enabled = 1 AND archived_at IS NULL AND next_sync_at = ?`,
    )
      .bind(now + integration.interval_minutes * 60, now, integration.id, scheduledAt)
      .run();
  }
}

export async function cleanupExpiredData(env: Env, now = Math.floor(Date.now() / 1000)) {
  const snapshotCutoff = now - SNAPSHOT_RETENTION_DAYS * 86_400;
  const rawSnapshotCutoff = now - RAW_SNAPSHOT_RETENTION_DAYS * 86_400;
  const runCutoff = now - 30 * 86_400;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM usage_snapshots WHERE id IN (
         SELECT id FROM usage_snapshots WHERE captured_at < ? LIMIT 1000
       )`,
    ).bind(snapshotCutoff),
    env.DB.prepare(
      `DELETE FROM usage_snapshots WHERE id IN (
         SELECT victim.id
         FROM usage_snapshots victim
         WHERE victim.captured_at < ? AND victim.captured_at >= ?
           AND EXISTS (
             SELECT 1 FROM usage_snapshots newer
             WHERE newer.integration_id = victim.integration_id
               AND CAST(newer.captured_at / 86400 AS INTEGER) =
                   CAST(victim.captured_at / 86400 AS INTEGER)
               AND (newer.captured_at > victim.captured_at OR
                    (newer.captured_at = victim.captured_at AND newer.id > victim.id))
           )
         LIMIT 1000
       )`,
    ).bind(rawSnapshotCutoff, snapshotCutoff),
    env.DB.prepare(
      `DELETE FROM sync_runs WHERE id IN (
         SELECT id FROM sync_runs WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM usage_snapshots s WHERE s.sync_run_id = sync_runs.id)
         LIMIT 2000
       )`,
    ).bind(runCutoff),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
  ]);
}

export async function processSync(
  env: Env,
  message: SyncMessage,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<ProcessResult> {
  const leaseExpiresAt = now + 120;
  const leaseToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    `UPDATE sync_runs
     SET status = 'running', started_at = COALESCE(started_at, ?), attempt = attempt + 1,
         lease_expires_at = ?, lease_token = ?
     WHERE id = ? AND integration_id = ?
       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))`,
  )
    .bind(now, leaseExpiresAt, leaseToken, message.runId, message.integrationId, now)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return { outcome: "done" };

  const row = await env.DB.prepare(
    `SELECT r.id AS run_id, r.integration_id, r.attempt, i.provider,
            i.browser_fallback_disabled_until,
            c.encrypted_payload, c.nonce, c.key_version
     FROM sync_runs r
     JOIN integrations i ON i.id = r.integration_id
     JOIN credential_secrets c ON c.integration_id = i.id
     WHERE r.id = ? AND r.lease_token = ? AND i.archived_at IS NULL`,
  )
    .bind(message.runId, leaseToken)
    .first<SyncRow>();
  if (!row) {
    await env.DB.prepare(
      `UPDATE sync_runs SET status = 'failed', finished_at = ?, lease_expires_at = NULL,
         lease_token = NULL, error_code = 'MISSING_CONFIG', error_message = ?
       WHERE id = ? AND lease_token = ?`,
    )
      .bind(now, "监控项或凭据不存在", message.runId, leaseToken)
      .run();
    return { outcome: "done" };
  }

  try {
    const aad = `${row.integration_id}:${row.provider}:${row.key_version}`;
    const credential = await decryptCredential<StoredCredential>(
      row.encrypted_payload,
      row.nonce,
      env.CREDENTIAL_ENCRYPTION_KEY,
      aad,
    );
    const adapter = adapters[row.provider];
    let prepared = adapter.prepareCredential
      ? await adapter.prepareCredential(credential as never, {
          now,
          fetch: fetcher,
          browser: env.BROWSER,
          browserFallbackDisabledUntil: row.browser_fallback_disabled_until ?? undefined,
          syncAttempt: row.attempt,
        })
      : credential;

    const persistCredential = async (
      previous: StoredCredential,
      successor: StoredCredential,
    ): Promise<void> => {
      if (successor === previous) return;
      const encrypted = await encryptCredential(successor, env.CREDENTIAL_ENCRYPTION_KEY, aad);
      const persisted = await env.DB.prepare(
        `UPDATE credential_secrets SET encrypted_payload = ?, nonce = ?, updated_at = ?
         WHERE integration_id = ? AND key_version = ?
           AND EXISTS (
             SELECT 1 FROM sync_runs r JOIN integrations i ON i.id = r.integration_id
             WHERE r.id = ? AND r.lease_token = ? AND r.status = 'running'
               AND i.archived_at IS NULL
           )`,
      )
        .bind(
          encrypted.encryptedPayload,
          encrypted.nonce,
          now,
          row.integration_id,
          row.key_version,
          row.run_id,
          leaseToken,
        )
        .run();
      if ((persisted.meta.changes ?? 0) !== 1) throw new Error("credential update conflict");
    };

    // OAuth providers may rotate refresh tokens. Persist the successor before the usage call so
    // a transient usage failure cannot strand the integration with an already-spent token.
    await persistCredential(credential, prepared);

    let result: CollectResult;
    try {
      result = await adapter.collect(prepared as never, {
        now,
        fetch: fetcher,
        browser: env.BROWSER,
        browserFallbackDisabledUntil: row.browser_fallback_disabled_until ?? undefined,
        syncAttempt: row.attempt,
      });
    } catch (collectError) {
      const classified = safeError(collectError);
      if (classified.code !== "AUTH_EXPIRED" || !adapter.prepareCredential) throw collectError;
      const refreshed = await adapter.prepareCredential(prepared as never, {
        now,
        fetch: fetcher,
        browser: env.BROWSER,
        browserFallbackDisabledUntil: row.browser_fallback_disabled_until ?? undefined,
        syncAttempt: row.attempt,
        forceRefresh: true,
      });
      await persistCredential(prepared, refreshed);
      prepared = refreshed;
      result = await adapter.collect(prepared as never, {
        now,
        fetch: fetcher,
        browser: env.BROWSER,
        browserFallbackDisabledUntil: row.browser_fallback_disabled_until ?? undefined,
        syncAttempt: row.attempt,
      });
    }
    const identity = result.snapshot.identity.email ?? result.snapshot.identity.username ?? null;
    const completed = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO usage_snapshots
            (id, integration_id, sync_run_id, provider, captured_at, schema_version, payload_json)
         SELECT ?, ?, ?, ?, ?, 1, ?
         WHERE EXISTS (
           SELECT 1 FROM sync_runs r JOIN integrations i ON i.id = r.integration_id
           WHERE r.id = ? AND r.lease_token = ? AND r.status = 'running'
             AND i.archived_at IS NULL
         )`,
      ).bind(
        crypto.randomUUID(),
        row.integration_id,
        row.run_id,
        row.provider,
        result.snapshot.capturedAt,
        JSON.stringify(result.snapshot),
        row.run_id,
        leaseToken,
      ),
      env.DB.prepare(
        `UPDATE integrations SET status = 'healthy', public_identity = ?, plan_name = ?,
             last_synced_at = ?, last_error_code = NULL,
             browser_fallback_disabled_until = NULL, updated_at = ?
         WHERE id = ? AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM sync_runs
             WHERE id = ? AND lease_token = ? AND status = 'running'
           )`,
      ).bind(
        identity,
        result.snapshot.plan ?? null,
        now,
        now,
        row.integration_id,
        row.run_id,
        leaseToken,
      ),
      env.DB.prepare(
        `UPDATE sync_runs SET status = 'succeeded', finished_at = ?, lease_expires_at = NULL,
             lease_token = NULL, error_code = NULL, error_message = NULL
         WHERE id = ? AND lease_token = ? AND status = 'running'`,
      ).bind(now, row.run_id, leaseToken),
    ]);
    if ((completed[0].meta.changes ?? 0) !== 1) return { outcome: "done" };
    return { outcome: "done" };
  } catch (unknownError) {
    const error = safeError(unknownError);
    const retry = error.retryable && row.attempt < 5;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE integrations SET status = CASE WHEN ? = 1 THEN 'action_required' ELSE status END,
             last_error_code = ?,
             browser_fallback_disabled_until = CASE WHEN ? = 1 THEN ?
               ELSE browser_fallback_disabled_until END,
             updated_at = ?
         WHERE id = ? AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM sync_runs
             WHERE id = ? AND lease_token = ? AND status = 'running'
           )`,
      ).bind(
        !retry && error.actionRequired ? 1 : 0,
        error.code,
        error.code === "BROWSER_FALLBACK_FAILED" ? 1 : 0,
        now + 3600,
        now,
        row.integration_id,
        row.run_id,
        leaseToken,
      ),
      env.DB.prepare(
        `UPDATE sync_runs SET status = ?, finished_at = ?, lease_expires_at = NULL,
             lease_token = NULL, error_code = ?, error_message = ?
         WHERE id = ? AND lease_token = ? AND status = 'running'`,
      ).bind(
        retry ? "queued" : "failed",
        retry ? null : now,
        error.code,
        error.message.slice(0, 300),
        row.run_id,
        leaseToken,
      ),
    ]);
    return {
      outcome: retry ? "retry" : "done",
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
}

export async function consumeSyncQueue(batch: MessageBatch<SyncMessage>, env: Env) {
  for (const message of batch.messages) {
    const result = await processSync(env, message.body, Math.floor(Date.now() / 1000));
    if (result.outcome === "retry") {
      message.retry({
        delaySeconds:
          result.retryAfterSeconds ?? Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)),
      });
    } else {
      message.ack();
    }
  }
}
