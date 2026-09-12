import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCredential } from "@/worker/adapters/types";
import { decryptCredential, encryptCredential, sha256 } from "@/worker/crypto";
import type { Env } from "@/worker/env";
import { AdapterError } from "@/worker/errors";
import { app, handleScheduled } from "@/worker/index";
import { processSync, scheduleDueIntegrations } from "@/worker/sync";
import cursorUsage from "../fixtures/cursor-usage.json";
import kimiUsage from "../fixtures/kimi-usage.json";

const TEST_ENCRYPTION_KEY = btoa("0123456789abcdef0123456789abcdef");

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT NOT NULL,
      public_identity TEXT, plan_name TEXT, status TEXT NOT NULL, enabled INTEGER NOT NULL,
      interval_minutes INTEGER NOT NULL, next_sync_at INTEGER NOT NULL, last_synced_at INTEGER,
      last_error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      archived_at INTEGER, browser_fallback_disabled_until INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usage_snapshots (
      id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, sync_run_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL, captured_at INTEGER NOT NULL, schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS credential_secrets (
      integration_id TEXT PRIMARY KEY, encrypted_payload TEXT NOT NULL, nonce TEXT NOT NULL,
      key_version INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, trigger_type TEXT NOT NULL,
      status TEXT NOT NULL, scheduled_at INTEGER NOT NULL, started_at INTEGER,
      finished_at INTEGER, attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT,
      error_message TEXT, lease_expires_at INTEGER, created_at INTEGER NOT NULL,
      lease_token TEXT, dedupe_key TEXT, enqueued_at INTEGER
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, github_user_id TEXT NOT NULL, github_login TEXT NOT NULL,
      github_avatar_url TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY, code_verifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_outbox (
      run_id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, available_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL
    )`),
  ]);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_snapshots"),
    env.DB.prepare("DELETE FROM credential_secrets"),
    env.DB.prepare("DELETE FROM sync_runs"),
    env.DB.prepare("DELETE FROM admin_sessions"),
    env.DB.prepare("DELETE FROM oauth_states"),
    env.DB.prepare("DELETE FROM sync_outbox"),
    env.DB.prepare("DELETE FROM integrations"),
  ]);
});

afterEach(() => vi.unstubAllGlobals());

async function seedKimiSync(runId: string, now: number) {
  const credential = { provider: "kimi", apiKey: "sk-kimi-test" } as const;
  const encrypted = await encryptCredential(credential, TEST_ENCRYPTION_KEY, "kimi-sync:kimi:1");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO integrations
        (id, provider, display_name, status, enabled, interval_minutes, next_sync_at,
         created_at, updated_at)
       VALUES ('kimi-sync', 'kimi', 'Kimi', 'pending', 1, 15, ?, ?, ?)`,
    ).bind(now, now, now),
    env.DB.prepare(
      `INSERT INTO credential_secrets
        (integration_id, encrypted_payload, nonce, key_version, updated_at)
       VALUES ('kimi-sync', ?, ?, 1, ?)`,
    ).bind(encrypted.encryptedPayload, encrypted.nonce, now),
    env.DB.prepare(
      `INSERT INTO sync_runs
        (id, integration_id, trigger_type, status, scheduled_at, created_at)
       VALUES (?, 'kimi-sync', 'manual', 'queued', ?, ?)`,
    ).bind(runId, now, now),
  ]);
}

async function seedCursorSync(runId: string, now: number) {
  const credential: StoredCredential = {
    provider: "cursor",
    apiKey: "crsr_test",
    accessToken: "cursor-access-old",
    accessTokenExpiresAt: now + 3600,
  };
  const encrypted = await encryptCredential(
    credential,
    TEST_ENCRYPTION_KEY,
    "cursor-sync:cursor:1",
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO integrations
        (id, provider, display_name, status, enabled, interval_minutes, next_sync_at,
         created_at, updated_at)
       VALUES ('cursor-sync', 'cursor', 'Cursor', 'pending', 1, 15, ?, ?, ?)`,
    ).bind(now, now, now),
    env.DB.prepare(
      `INSERT INTO credential_secrets
        (integration_id, encrypted_payload, nonce, key_version, updated_at)
       VALUES ('cursor-sync', ?, ?, 1, ?)`,
    ).bind(encrypted.encryptedPayload, encrypted.nonce, now),
    env.DB.prepare(
      `INSERT INTO sync_runs
        (id, integration_id, trigger_type, status, scheduled_at, created_at)
       VALUES (?, 'cursor-sync', 'manual', 'queued', ?, ?)`,
    ).bind(runId, now, now),
  ]);
}

function syncEnv(adminGithubIds = "1"): Env {
  return {
    DB: env.DB,
    SYNC_QUEUE: env.SYNC_QUEUE,
    ASSETS: env.ASSETS,
    APP_URL: "http://example.com",
    GITHUB_CLIENT_ID: "test",
    GITHUB_CLIENT_SECRET: "test",
    ADMIN_GITHUB_IDS: adminGithubIds,
    CREDENTIAL_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

describe("公开 API", () => {
  it("无需管理员会话即可查看看板，且相同用量的快照仍逐条保留", async () => {
    const now = 1_700_000_000;
    const payload = JSON.stringify({
      schemaVersion: 1,
      provider: "kimi",
      capturedAt: now,
      identity: { email: "public@example.com" },
      plan: "Pro",
      metrics: [
        {
          key: "weekly",
          label: "每周",
          kind: "quota_window",
          unit: "%",
          used: 20,
          limit: 100,
          percentage: 20,
        },
      ],
      source: { adapterVersion: "test/1" },
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO integrations
          (id, provider, display_name, public_identity, plan_name, status, enabled,
           interval_minutes, next_sync_at, last_synced_at, last_error_code,
           created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        "kimi-1",
        "kimi",
        "Kimi 主账号",
        "public@example.com",
        "Pro",
        "healthy",
        1,
        15,
        now + 900,
        now,
        null,
        now,
        now,
        null,
      ),
      env.DB.prepare(`INSERT INTO usage_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        "s1",
        "kimi-1",
        "r1",
        "kimi",
        now - 60,
        1,
        payload,
      ),
      env.DB.prepare(`INSERT INTO usage_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        "s2",
        "kimi-1",
        "r2",
        "kimi",
        now,
        1,
        payload,
      ),
      env.DB.prepare(`INSERT INTO usage_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        "s3",
        "kimi-1",
        "r3",
        "kimi",
        now,
        1,
        payload,
      ),
      env.DB.prepare(`INSERT INTO usage_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        "s4",
        "kimi-1",
        "r4",
        "kimi",
        now,
        1,
        payload,
      ),
    ]);

    const dashboard = await app.request(
      "http://example.com/api/v1/public/dashboard",
      {},
      env as never,
    );
    expect(dashboard.status).toBe(200);
    const dashboardBody = (await dashboard.json()) as { data: Array<{ displayName: string }> };
    expect(dashboardBody.data[0].displayName).toBe("Kimi 主账号");

    const snapshots = await app.request(
      "http://example.com/api/v1/public/integrations/kimi-1/snapshots",
      {},
      env as never,
    );
    const snapshotsBody = (await snapshots.json()) as { data: unknown[] };
    expect(snapshotsBody.data).toHaveLength(4);

    const firstPage = await app.request(
      "http://example.com/api/v1/public/integrations/kimi-1/snapshots?limit=2",
      {},
      env as never,
    );
    const firstPageBody = (await firstPage.json()) as {
      data: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(firstPageBody.data.map((row) => row.id)).toEqual(["s4", "s3"]);
    expect(firstPageBody.nextCursor).toBeTypeOf("string");

    const secondPage = await app.request(
      `http://example.com/api/v1/public/integrations/kimi-1/snapshots?limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? "")}`,
      {},
      env as never,
    );
    const secondPageBody = (await secondPage.json()) as { data: Array<{ id: string }> };
    expect(secondPageBody.data.map((row) => row.id)).toEqual(["s2", "s1"]);
  });
});

describe("同步 fencing", () => {
  it("持有有效租约时原子写入不可变快照并完成任务", async () => {
    const now = 1_700_000_000;
    await seedKimiSync("run-success", now);
    const result = await processSync(
      syncEnv(),
      { integrationId: "kimi-sync", runId: "run-success" },
      now,
      (async () => Response.json(kimiUsage)) as typeof fetch,
    );
    expect(result).toEqual({ outcome: "done" });
    const run = await env.DB.prepare("SELECT status, attempt FROM sync_runs WHERE id = ?")
      .bind("run-success")
      .first<{ status: string; attempt: number }>();
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_snapshots WHERE sync_run_id = ?",
    )
      .bind("run-success")
      .first<{ count: number }>();
    expect(run).toEqual({ status: "succeeded", attempt: 1 });
    expect(count?.count).toBe(1);
  });

  it("租约被新消费者接管后旧消费者不能插入快照或覆盖状态", async () => {
    const now = 1_700_000_000;
    await seedKimiSync("run-stale", now);
    const fetcher = async () => {
      await env.DB.prepare("UPDATE sync_runs SET lease_token = 'new-owner' WHERE id = ?")
        .bind("run-stale")
        .run();
      return Response.json(kimiUsage);
    };
    await processSync(
      syncEnv(),
      { integrationId: "kimi-sync", runId: "run-stale" },
      now,
      fetcher as typeof fetch,
    );
    const run = await env.DB.prepare("SELECT status, lease_token FROM sync_runs WHERE id = ?")
      .bind("run-stale")
      .first<{ status: string; lease_token: string }>();
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_snapshots WHERE sync_run_id = ?",
    )
      .bind("run-stale")
      .first<{ count: number }>();
    expect(run).toEqual({ status: "running", lease_token: "new-owner" });
    expect(count?.count).toBe(0);
  });

  it("访问令牌被提前撤销时强制刷新一次并持久化后再采集", async () => {
    const now = 1_700_000_000;
    await seedCursorSync("run-refresh", now);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.endsWith("/auth/exchange_user_api_key")) {
        return Response.json({ accessToken: "cursor-access-new", expiresIn: 3600 });
      }
      if (url.endsWith("/GetCurrentPeriodUsage")) {
        return authorization === "Bearer cursor-access-old"
          ? Response.json({ error: "expired" }, { status: 401 })
          : Response.json(cursorUsage);
      }
      if (url.endsWith("/GetPlanInfo")) {
        return Response.json({ planInfo: { planName: "Cursor Pro" } });
      }
      if (url.endsWith("/GetMe")) return Response.json({ email: "cursor@example.com" });
      return Response.json({ error: "not found" }, { status: 404 });
    });

    await processSync(
      syncEnv(),
      { integrationId: "cursor-sync", runId: "run-refresh" },
      now,
      fetcher as typeof fetch,
    );
    const run = await env.DB.prepare("SELECT status FROM sync_runs WHERE id = ?")
      .bind("run-refresh")
      .first<{ status: string }>();
    const stored = await env.DB.prepare(
      `SELECT encrypted_payload, nonce FROM credential_secrets WHERE integration_id = ?`,
    )
      .bind("cursor-sync")
      .first<{ encrypted_payload: string; nonce: string }>();
    if (!stored) throw new Error("凭据未保存");
    const credential = await decryptCredential<StoredCredential>(
      stored.encrypted_payload,
      stored.nonce,
      TEST_ENCRYPTION_KEY,
      "cursor-sync:cursor:1",
    );
    expect(run?.status).toBe("succeeded");
    expect(credential).toMatchObject({ accessToken: "cursor-access-new" });
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("GetCurrentPeriodUsage")),
    ).toHaveLength(2);
  });

  it("Kimi Browser Run 失败时设置一小时熔断，后续直接请求成功时清除", async () => {
    const now = 1_700_000_000;
    await seedKimiSync("run-browser-failed", now);
    const browserFailure = async () => {
      throw new AdapterError("BROWSER_FALLBACK_FAILED", "Kimi Browser Run 回退失败", false);
    };
    expect(
      await processSync(
        syncEnv(),
        { integrationId: "kimi-sync", runId: "run-browser-failed" },
        now,
        browserFailure as typeof fetch,
      ),
    ).toEqual({ outcome: "done" });
    const failed = await env.DB.prepare(
      `SELECT status, browser_fallback_disabled_until
       FROM integrations WHERE id = 'kimi-sync'`,
    ).first<{ status: string; browser_fallback_disabled_until: number }>();
    expect(failed).toEqual({
      status: "pending",
      browser_fallback_disabled_until: now + 3600,
    });

    await env.DB.prepare(
      `INSERT INTO sync_runs
        (id, integration_id, trigger_type, status, scheduled_at, created_at)
       VALUES ('run-browser-recovered', 'kimi-sync', 'manual', 'queued', ?, ?)`,
    )
      .bind(now + 60, now + 60)
      .run();
    expect(
      await processSync(
        syncEnv(),
        { integrationId: "kimi-sync", runId: "run-browser-recovered" },
        now + 60,
        (async () => Response.json(kimiUsage)) as typeof fetch,
      ),
    ).toEqual({ outcome: "done" });
    const recovered = await env.DB.prepare(
      `SELECT status, browser_fallback_disabled_until
       FROM integrations WHERE id = 'kimi-sync'`,
    ).first<{ status: string; browser_fallback_disabled_until: number | null }>();
    expect(recovered).toEqual({ status: "healthy", browser_fallback_disabled_until: null });
  });
});

describe("低用量定时调度", () => {
  it("每个到期周期只入队一次并从当前调度时间推进下一次同步", async () => {
    const now = 1_700_000_000;
    await env.DB.prepare(
      `INSERT INTO integrations
        (id, provider, display_name, status, enabled, interval_minutes, next_sync_at,
         created_at, updated_at)
       VALUES ('scheduled-kimi', 'kimi', 'Kimi', 'healthy', 1, 15, ?, ?, ?)`,
    )
      .bind(now, now, now)
      .run();
    const send = vi.fn(async () => undefined);
    const schedulerEnv = { ...syncEnv(), SYNC_QUEUE: { send } as unknown as Queue };

    await scheduleDueIntegrations(schedulerEnv, now);
    await scheduleDueIntegrations(schedulerEnv, now);

    const runCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sync_runs WHERE integration_id = 'scheduled-kimi'",
    ).first<{ count: number }>();
    const integration = await env.DB.prepare(
      "SELECT next_sync_at FROM integrations WHERE id = 'scheduled-kimi'",
    ).first<{ next_sync_at: number }>();
    expect(send).toHaveBeenCalledTimes(1);
    expect(runCount?.count).toBe(1);
    expect(integration?.next_sync_at).toBe(now + 15 * 60);
  });

  it("每日维护 Cron 只清理数据，不调度监控项", async () => {
    const now = 1_700_000_000;
    await env.DB.prepare(
      `INSERT INTO admin_sessions
        (token_hash, github_user_id, github_login, expires_at, created_at)
       VALUES ('expired', '1', 'admin', ?, ?)`,
    )
      .bind(now - 1, now - 100)
      .run();
    const send = vi.fn(async () => undefined);
    const schedulerEnv = { ...syncEnv(), SYNC_QUEUE: { send } as unknown as Queue };

    await handleScheduled(
      { cron: "17 19 * * *", scheduledTime: now * 1000 } as ScheduledController,
      schedulerEnv,
    );

    const session = await env.DB.prepare(
      "SELECT token_hash FROM admin_sessions WHERE token_hash = 'expired'",
    ).first();
    expect(session).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("监控项展示排序", () => {
  it("持久化完整排序，并让公开看板与后台使用同一顺序", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = "reorder-session-token";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO admin_sessions
          (token_hash, github_user_id, github_login, expires_at, created_at)
         VALUES (?, '1', 'admin', ?, ?)`,
      ).bind(await sha256(token), now + 3600, now),
      ...[
        ["first", "First", 100],
        ["second", "Second", 200],
        ["third", "Third", 300],
      ].map(([id, name, order], index) =>
        env.DB.prepare(
          `INSERT INTO integrations
            (id, provider, display_name, status, enabled, interval_minutes, next_sync_at,
             sort_order, created_at, updated_at)
           VALUES (?, 'kimi', ?, 'healthy', 0, 60, ?, ?, ?, ?)`,
        ).bind(id, name, now, order, now + index, now),
      ),
    ]);
    const headers = {
      "content-type": "application/json",
      cookie: `usage_cat_session=${token}`,
    };

    const reordered = await app.request(
      "http://example.com/api/v1/admin/integrations/reorder",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ orderedIds: ["third", "first", "second"] }),
      },
      syncEnv(),
    );
    expect(reordered.status).toBe(200);

    const adminResponse = await app.request(
      "http://example.com/api/v1/admin/integrations",
      { headers },
      syncEnv(),
    );
    const adminBody = await adminResponse.json<{
      data: Array<{ id: string; sortOrder: number }>;
    }>();
    expect(adminBody.data.map((item) => item.id)).toEqual(["third", "first", "second"]);
    expect(adminBody.data.map((item) => item.sortOrder)).toEqual([100, 200, 300]);

    const dashboard = await app.request(
      "http://example.com/api/v1/public/dashboard",
      {},
      syncEnv(),
    );
    const dashboardBody = await dashboard.json<{ data: Array<{ id: string }> }>();
    expect(dashboardBody.data.map((item) => item.id)).toEqual(["third", "first", "second"]);

    const stale = await app.request(
      "http://example.com/api/v1/admin/integrations/reorder",
      { method: "POST", headers, body: JSON.stringify({ orderedIds: ["first", "second"] }) },
      syncEnv(),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "ORDER_STALE" } });
  });
});

describe("GitHub 登录", () => {
  it("使用加密短期 Cookie 保存 PKCE state，不依赖匿名 D1 写入", async () => {
    const response = await app.request("http://example.com/api/v1/auth/github", {}, syncEnv());
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("usage_cat_oauth=");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("完成 PKCE 回调后创建会话，并在白名单撤销时立即失效", async () => {
    const begin = await app.request("http://example.com/api/v1/auth/github", {}, syncEnv());
    const authorization = new URL(begin.headers.get("location") ?? "");
    const state = authorization.searchParams.get("state");
    const oauthCookie = begin.headers.get("set-cookie")?.match(/usage_cat_oauth=([^;]+)/)?.[1];
    expect(state).toBeTruthy();
    expect(oauthCookie).toBeTruthy();

    const githubFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "github-access" });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({ id: 1, login: "admin", avatar_url: "https://example.com/a.png" });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", githubFetch);

    const callback = await app.request(
      `http://example.com/api/v1/auth/github/callback?code=test-code&state=${encodeURIComponent(state ?? "")}`,
      { headers: { cookie: `usage_cat_oauth=${oauthCookie}` } },
      syncEnv(),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/admin");
    const sessionCookie = callback.headers
      .get("set-cookie")
      ?.match(/usage_cat_session=([^;]+)/)?.[1];
    expect(sessionCookie).toBeTruthy();
    expect(githubFetch).toHaveBeenCalledTimes(2);
    expect(githubFetch.mock.calls[0]?.[1]?.redirect).toBe("manual");

    const session = await app.request(
      "http://example.com/api/v1/admin/session",
      { headers: { cookie: `usage_cat_session=${sessionCookie}` } },
      syncEnv(),
    );
    expect(session.status).toBe(200);

    const revoked = await app.request(
      "http://example.com/api/v1/admin/session",
      { headers: { cookie: `usage_cat_session=${sessionCookie}` } },
      syncEnv("2"),
    );
    expect(revoked.status).toBe(401);
  });
});
