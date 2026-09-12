import { describe, expect, it, vi } from "vitest";
import type { KimiCredentialMode } from "@/shared/usage";
import { normalizeCredential } from "@/worker/adapters";
import { codexAdapter } from "@/worker/adapters/codex";
import { cursorAdapter } from "@/worker/adapters/cursor";
import { grokAdapter } from "@/worker/adapters/grok";
import { requestJson } from "@/worker/adapters/helpers";
import { kimiAdapter } from "@/worker/adapters/kimi";
import { zenmuxAdapter } from "@/worker/adapters/zenmux";
import codexUsage from "../fixtures/codex-usage.json";
import cursorUsage from "../fixtures/cursor-usage.json";
import grokBilling from "../fixtures/grok-billing.json";
import kimiUsage from "../fixtures/kimi-usage.json";
import zenmuxSubscription from "../fixtures/zenmux-subscription.json";

const launchBrowserMock = vi.hoisted(() => vi.fn());
vi.mock("@cloudflare/puppeteer", () => ({ default: { launch: launchBrowserMock } }));

function jsonFetch(body: unknown, init: ResponseInit = {}) {
  return vi.fn(async () => Response.json(body, init)) as unknown as typeof fetch;
}

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (!route) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(route[1]);
  }) as unknown as typeof fetch;
}

describe("凭据导入", () => {
  it("只提取 Codex 刷新需要的字段", () => {
    const credential = normalizeCredential(
      "codex",
      JSON.stringify({
        tokens: {
          access_token: "access",
          refresh_token: "refresh",
          account_id: "account",
          secret_extra: "drop",
        },
      }),
    );
    expect(credential).toEqual({
      provider: "codex",
      accessToken: "access",
      refreshToken: "refresh",
      accountId: "account",
      idToken: undefined,
      expiresAt: undefined,
    });
    expect(JSON.stringify(credential)).not.toContain("secret_extra");
  });

  it("读取 Grok 官方 auth.json 的 key、user_id 与 ISO 过期时间", () => {
    const credential = normalizeCredential(
      "grok",
      JSON.stringify({
        key: "grok-access",
        user_id: "user-1",
        email: "grok@example.com",
        first_name: "Grok",
        last_name: "User",
        refresh_token: "grok-refresh",
        expires_at: "2030-01-01T00:00:00Z",
        oidc_issuer: "https://auth.x.ai",
        oidc_client_id: "client-1",
      }),
    );
    expect(credential).toMatchObject({
      provider: "grok",
      accessToken: "grok-access",
      userId: "user-1",
      username: "Grok User",
      expiresAt: 1_893_456_000,
    });
  });

  it("把 auth.json 中字符串形式的毫秒过期时间转换为秒", () => {
    const credential = normalizeCredential(
      "codex",
      JSON.stringify({
        tokens: {
          access_token: "access",
          refresh_token: "refresh",
          account_id: "account",
          expires_at: "1893456000000",
        },
      }),
    );
    if (credential.provider !== "codex") throw new Error("凭据平台错误");
    expect(credential.expiresAt).toBe(1_893_456_000);
  });

  it("拒绝格式错误的稳定 API Key", () => {
    expect(() => normalizeCredential("kimi", "not-a-key")).toThrow("sk-kimi-");
    expect(normalizeCredential("kimi", "sk-kimi-code", "code_global")).toEqual({
      provider: "kimi",
      apiKey: "sk-kimi-code",
      mode: "code_global",
    });
    expect(normalizeCredential("kimi", "sk-platform-key", "platform_cn")).toEqual({
      provider: "kimi",
      apiKey: "sk-platform-key",
      mode: "platform_cn",
    });
    expect(() => normalizeCredential("kimi", "sk-kimi-code", "platform_global")).toThrow(
      "Kimi Code Key",
    );
  });

  it("明确区分 ZenMux 订阅推理 Key 与用量管理 Key", () => {
    expect(() => normalizeCredential("zenmux", "sk-ss-v1-subscription")).toThrow(
      "订阅推理 Key 不能查询账户用量",
    );
    expect(normalizeCredential("zenmux", "sk-mg-v1-management")).toEqual({
      provider: "zenmux",
      apiKey: "sk-mg-v1-management",
    });
  });
});

describe("平台适配器契约", () => {
  it("使用 Workers 支持的 manual 模式并显式拒绝上游重定向", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
    }) as unknown as typeof fetch;

    await expect(requestJson(fetcher, "https://api.example.test/usage", {})).rejects.toMatchObject({
      code: "UPSTREAM_SCHEMA_CHANGED",
      retryable: false,
      actionRequired: true,
    });
  });

  it("按 Codex 官方客户端契约刷新并保留旋转后的 refresh token", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: "codex-access-new",
        refresh_token: "codex-refresh-new",
        id_token: "codex-id-new",
        expires_in: 3600,
      }),
    ) as unknown as typeof fetch;
    const prepared = await codexAdapter.prepareCredential?.(
      {
        provider: "codex",
        accessToken: "codex-access-old",
        refreshToken: "codex-refresh-old",
        accountId: "account",
        expiresAt: 1_699_999_000,
      },
      { now: 1_700_000_000, fetch: fetcher },
    );
    expect(prepared).toMatchObject({
      accessToken: "codex-access-new",
      refreshToken: "codex-refresh-new",
      idToken: "codex-id-new",
      expiresAt: 1_700_003_600,
    });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://auth.openai.com/oauth/token");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: "codex-refresh-old",
    });
  });

  it("将 Codex invalid_grant 识别为不可重试的凭据失效", async () => {
    const fetcher = jsonFetch({ error: "invalid_grant" }, { status: 400 });
    await expect(
      codexAdapter.prepareCredential?.(
        {
          provider: "codex",
          accessToken: "codex-access-old",
          refreshToken: "codex-refresh-old",
          accountId: "account",
          expiresAt: 1_699_999_000,
        },
        { now: 1_700_000_000, fetch: fetcher },
      ),
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      retryable: false,
      actionRequired: true,
      message: "凭据验证失败（上游 400，invalid_grant），请检查凭据类型与区域",
    });
  });

  it("解析 Codex 基础窗口、附加窗口、余额与 spend control", async () => {
    const result = await codexAdapter.collect(
      {
        provider: "codex",
        accessToken: "access",
        refreshToken: "refresh",
        accountId: "account",
        expiresAt: 9_999_999_999,
      },
      { now: 1_700_000_000, fetch: jsonFetch(codexUsage) },
    );
    expect(result.snapshot.metrics.map((metric) => metric.key)).toEqual([
      "codex-primary",
      "codex-secondary",
      "codex-codex_other-primary",
      "codex-credits",
      "codex-spend-control",
    ]);
    expect(result.snapshot.metrics[0]).toMatchObject({ percentage: 42, resetAt: 1_700_001_000 });
    expect(result.snapshot.metrics[0]).toMatchObject({
      kind: "quota_window",
      remaining: 58,
    });
    expect(result.snapshot.metrics.at(-1)).toMatchObject({
      kind: "quota_window",
      used: 8000,
      limit: 25000,
      remaining: 17000,
    });
    expect(result.snapshot.source.adapterVersion).toBe("codex/3");
  });

  it("兼容官方协议省略的零用量字段", async () => {
    const codex = await codexAdapter.collect(
      {
        provider: "codex",
        accessToken: "access",
        refreshToken: "refresh",
        accountId: "account",
        expiresAt: 9_999_999_999,
      },
      {
        now: 1_700_000_000,
        fetch: jsonFetch({
          rate_limit: {
            primary_window: { limit_window_seconds: 18_000, reset_at: 1_700_001_000 },
          },
        }),
      },
    );
    expect(codex.snapshot.metrics[0].percentage).toBe(0);

    const cursor = await cursorAdapter.collect(
      { provider: "cursor", apiKey: "crsr_test", accessToken: "access" },
      {
        now: 1_700_000_000,
        fetch: routeFetch({
          "/aiserver.v1.DashboardService/GetCurrentPeriodUsage": {
            planUsage: { limit: 10_000, remaining: 10_000 },
          },
          "/aiserver.v1.DashboardService/GetPlanInfo": {},
          "/aiserver.v1.DashboardService/GetMe": {},
        }),
      },
    );
    expect(cursor.snapshot.metrics[0]).toMatchObject({ used: 0, limit: 10_000 });

    const grok = await grokAdapter.collect(
      { provider: "grok", accessToken: "access", userId: "user-1" },
      {
        now: 1_700_000_000,
        fetch: routeFetch({
          "/billing?format=credits": {
            config: { creditUsagePercent: 0, prepaidBalance: {} },
          },
          "/settings": {},
        }),
      },
    );
    expect(grok.snapshot.metrics.at(-1)).toMatchObject({
      key: "grok-prepaid-balance",
      value: 0,
    });
  });

  it("按 Cursor 官方 CLI 方式交换 API Key 并解析 Connect 响应", async () => {
    const fetcher = routeFetch({
      "/auth/exchange_user_api_key": {
        accessToken: "cursor-access",
        refreshToken: "cursor-refresh",
        expiresIn: 3600,
      },
      "/aiserver.v1.DashboardService/GetCurrentPeriodUsage": cursorUsage,
      "/aiserver.v1.DashboardService/GetPlanInfo": {
        planInfo: { planName: "Cursor Pro", includedAmountCents: 10000 },
      },
      "/aiserver.v1.DashboardService/GetMe": { email: "cursor@example.com" },
      "/aiserver.v1.DashboardService/GetSandUsageStatus": {
        currentPeriodStart: "1702512000000",
        nextResetTimestampUtc: "1703116800000",
        usagePercent: 0,
        hasAvailableUsage: true,
        hasNonZeroIncludedLimit: true,
        onDemandSettings: { visible: true, eligible: true },
      },
    });
    const prepared = await cursorAdapter.prepareCredential?.(
      { provider: "cursor", apiKey: "crsr_test" },
      { now: 1_700_000_000, fetch: fetcher },
    );
    expect(prepared).toMatchObject({
      accessToken: "cursor-access",
      accessTokenExpiresAt: 1_700_003_600,
    });
    const exchangeInit = vi.mocked(fetcher).mock.calls[0]?.[1];
    expect(new Headers(exchangeInit?.headers).get("authorization")).toBe("Bearer crsr_test");
    expect(exchangeInit?.body).toBe("{}");
    if (!prepared) throw new Error("Cursor prepareCredential 不可用");

    const result = await cursorAdapter.collect(prepared, { now: 1_700_000_000, fetch: fetcher });
    expect(result.snapshot.plan).toBe("Cursor Pro");
    expect(result.snapshot.identity.email).toBe("cursor@example.com");
    expect(result.snapshot.metrics).toHaveLength(3);
    expect(result.snapshot.metrics[0]).toMatchObject({
      key: "cursor-models",
      kind: "quota_window",
      used: 35,
      limit: 100,
      remaining: 65,
      periodStart: 1_700_000_000,
    });
    expect(result.snapshot.metrics[1]).toMatchObject({
      key: "cursor-other-models",
      kind: "quota_window",
      used: 53,
      remaining: 47,
    });
    expect(result.snapshot.metrics[2]).toMatchObject({
      key: "cursor-grok-bot-weekly",
      kind: "quota_window",
      used: 0,
      remaining: 100,
      periodEnd: 1_703_116_800,
    });
    expect(result.snapshot.metrics).not.toContainEqual(
      expect.objectContaining({ key: "cursor-usage-based" }),
    );
    expect(result.snapshot.source.adapterVersion).toBe("cursor/4");
  });

  it("Cursor 旧版响应没有百分比时保留金额额度并解析启用的按量付费", async () => {
    const fetcher = routeFetch({
      "/aiserver.v1.DashboardService/GetCurrentPeriodUsage": {
        billingCycleStart: "1700000000000",
        billingCycleEnd: "1702592000000",
        planUsage: { totalSpend: 4200, remaining: 5800, limit: 10000 },
        spendLimitUsage: {
          totalSpend: 900,
          individualLimit: 5000,
          individualRemaining: 4100,
          limitType: "individual",
        },
      },
    });
    const result = await cursorAdapter.collect(
      { provider: "cursor", apiKey: "crsr_test", accessToken: "cursor-access" },
      { now: 1_700_000_000, fetch: fetcher },
    );
    expect(result.snapshot.metrics[0]).toMatchObject({
      key: "cursor-plan-usage",
      kind: "quota_window",
      used: 4200,
      remaining: 5800,
    });
    expect(result.snapshot.metrics[1]).toMatchObject({
      key: "cursor-usage-based",
      kind: "quota_window",
      used: 900,
      remaining: 4100,
    });
  });

  it("Cursor access token 被提前撤销时可强制重新交换", async () => {
    const fetcher = jsonFetch({ accessToken: "cursor-access-new", expiresIn: 3600 });
    const prepared = await cursorAdapter.prepareCredential?.(
      {
        provider: "cursor",
        apiKey: "crsr_test",
        accessToken: "cursor-access-old",
        accessTokenExpiresAt: 1_700_100_000,
      },
      { now: 1_700_000_000, fetch: fetcher, forceRefresh: true },
    );
    expect(prepared).toMatchObject({
      accessToken: "cursor-access-new",
      accessTokenExpiresAt: 1_700_003_600,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("解析 Grok credits config 并发送官方客户端身份头", async () => {
    const fetcher = routeFetch({
      "/billing?format=credits": grokBilling,
      "/settings": { subscription_tier_display: "SuperGrok Heavy" },
    });
    const result = await grokAdapter.collect(
      {
        provider: "grok",
        accessToken: "grok-access",
        userId: "user-1",
        email: "grok@example.com",
      },
      { now: 1_700_000_000, fetch: fetcher },
    );
    expect(result.snapshot.plan).toBe("SuperGrok Heavy");
    expect(result.snapshot.metrics.map((metric) => metric.key)).toEqual([
      "grok-included-credits",
      "grok-on-demand",
      "grok-prepaid-balance",
    ]);
    expect(result.snapshot.metrics[0].percentage).toBe(42.5);
    expect(result.snapshot.metrics[0]).toMatchObject({
      kind: "quota_window",
      remaining: 57.5,
    });
    expect(result.snapshot.metrics[1]).toMatchObject({
      kind: "quota_window",
      remaining: 4700,
    });
    expect(result.snapshot.source.adapterVersion).toBe("grok/3");
    const headers = new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-userid")).toBe("user-1");
    expect(headers.get("x-grok-client-mode")).toBe("headless");
    expect(headers.get("x-xai-token-auth")).toBe("xai-grok-cli");
  });

  it("按 Grok OIDC discovery 刷新团队凭据并传递 principal", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({ token_endpoint: "https://auth.x.ai/oauth/token" });
      }
      if (url === "https://auth.x.ai/oauth/token") {
        return Response.json({
          access_token: "grok-access-new",
          refresh_token: "grok-refresh-new",
          expires_in: 7200,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }) as unknown as typeof fetch;
    const prepared = await grokAdapter.prepareCredential?.(
      {
        provider: "grok",
        accessToken: "grok-access-old",
        refreshToken: "grok-refresh-old",
        expiresAt: 1_699_999_000,
        issuer: "https://auth.x.ai",
        clientId: "grok-client",
        userId: "user-1",
        principalType: "Team",
        principalId: "team-1",
      },
      { now: 1_700_000_000, fetch: fetcher },
    );
    expect(prepared).toMatchObject({
      accessToken: "grok-access-new",
      refreshToken: "grok-refresh-new",
      expiresAt: 1_700_007_200,
    });
    const [, refreshInit] = vi.mocked(fetcher).mock.calls[1] ?? [];
    expect(new Headers(refreshInit?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(new URLSearchParams(String(refreshInit?.body)))).toEqual({
      client_id: "grok-client",
      grant_type: "refresh_token",
      principal_id: "team-1",
      principal_type: "Team",
      refresh_token: "grok-refresh-old",
    });
  });

  it("解析 ZenMux 官方 flow 配额结构和 0–1 百分比", async () => {
    const result = await zenmuxAdapter.collect(
      { provider: "zenmux", apiKey: "sk-mg-v1-test" },
      { now: 1_700_000_000, fetch: jsonFetch(zenmuxSubscription) },
    );
    expect(result.snapshot.plan).toBe("professional");
    expect(result.snapshot.metrics).toHaveLength(3);
    expect(result.snapshot.metrics[0]).toMatchObject({
      key: "zenmux-5h",
      used: 57.2,
      limit: 800,
      percentage: 7.15,
    });
  });

  it("解析 Kimi weekly、window/detail 与 Booster wallet", async () => {
    const result = await kimiAdapter.collect(
      { provider: "kimi", apiKey: "sk-kimi-test" },
      { now: 1_700_000_000, fetch: jsonFetch(kimiUsage) },
    );
    expect(result.snapshot.metrics.map((metric) => metric.key)).toEqual([
      "kimi-weekly",
      "kimi-5-hour",
      "kimi-booster-balance",
      "kimi-booster-monthly",
    ]);
    expect(result.snapshot.metrics[1]).toMatchObject({ used: 1, limit: 100, percentage: 1 });
    expect(result.snapshot.metrics[0]).toMatchObject({
      kind: "quota_window",
      remaining: 960,
    });
    expect(result.snapshot.metrics[1]).toMatchObject({ remaining: 99 });
    expect(result.snapshot.metrics[2]).toMatchObject({ value: 10000, unit: "USD cents" });
    expect(result.snapshot.metrics[3]).toMatchObject({
      kind: "quota_window",
      used: 5000,
      limit: 20000,
      remaining: 15000,
    });
    expect(result.snapshot.source.adapterVersion).toBe("kimi/5");
  });

  it("Kimi Code 海外区使用独立的 api.kimi.ai 用量端点", async () => {
    const fetcher = vi.fn(async () => Response.json(kimiUsage));
    await kimiAdapter.collect(
      { provider: "kimi", apiKey: "sk-kimi-test", mode: "code_global" },
      { now: 1_700_000_000, fetch: fetcher as typeof fetch },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.kimi.ai/coding/v1/usages",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer sk-kimi-test",
          "user-agent": "usage-cat/1.0 (+https://usage.lakphy.me)",
        }),
      }),
    );
  });

  it("Kimi 普通网络错误和普通 403 不启动 Browser Run", async () => {
    launchBrowserMock.mockReset();
    const browser = {} as Fetcher;
    const networkFailure = vi.fn(async () => {
      throw new TypeError("network unavailable");
    }) as unknown as typeof fetch;
    await expect(
      kimiAdapter.collect(
        { provider: "kimi", apiKey: "sk-kimi-test" },
        { now: 1_700_000_000, fetch: networkFailure, browser },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });

    const ordinaryForbidden = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(
      kimiAdapter.collect(
        { provider: "kimi", apiKey: "sk-kimi-test" },
        { now: 1_700_000_000, fetch: ordinaryForbidden as typeof fetch, browser },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(launchBrowserMock).not.toHaveBeenCalled();
  });

  it("Kimi 重复网络错误从第二次同步尝试开始使用 Browser Run", async () => {
    launchBrowserMock.mockReset();
    const close = vi.fn(async () => undefined);
    launchBrowserMock.mockResolvedValue({
      newPage: async () => ({
        setExtraHTTPHeaders: vi.fn(async () => undefined),
        goto: vi.fn(async () => ({
          status: () => 200,
          text: async () => JSON.stringify(kimiUsage),
          headers: () => ({ "content-type": "application/json" }),
        })),
      }),
      close,
    });
    const networkFailure = vi.fn(async () => {
      throw new TypeError("network unavailable");
    }) as unknown as typeof fetch;

    const result = await kimiAdapter.collect(
      { provider: "kimi", apiKey: "sk-kimi-test" },
      {
        now: 1_700_000_000,
        fetch: networkFailure,
        browser: {} as Fetcher,
        syncAttempt: 2,
      },
    );
    expect(result.snapshot.metrics).not.toHaveLength(0);
    expect(launchBrowserMock).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Kimi 只为 Cloudflare Challenge 启动 Browser Run", async () => {
    launchBrowserMock.mockReset();
    const close = vi.fn(async () => undefined);
    const page = {
      setExtraHTTPHeaders: vi.fn(async () => undefined),
      goto: vi.fn(async () => ({
        status: () => 200,
        text: async () => JSON.stringify(kimiUsage),
        headers: () => ({ "content-type": "application/json" }),
      })),
    };
    launchBrowserMock.mockResolvedValue({ newPage: async () => page, close });
    const challenge = vi.fn(
      async () =>
        new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge", "content-type": "text/html" },
        }),
    );

    const result = await kimiAdapter.collect(
      { provider: "kimi", apiKey: "sk-kimi-test" },
      { now: 1_700_000_000, fetch: challenge as typeof fetch, browser: {} as Fetcher },
    );
    expect(result.snapshot.metrics).not.toHaveLength(0);
    expect(launchBrowserMock).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Kimi Browser Run 失败后返回不可重试错误，熔断期不再启动浏览器", async () => {
    launchBrowserMock.mockReset();
    const close = vi.fn(async () => undefined);
    launchBrowserMock.mockResolvedValue({
      newPage: async () => ({
        setExtraHTTPHeaders: vi.fn(async () => undefined),
        goto: vi.fn(async () => {
          throw new Error("browser launch failed");
        }),
      }),
      close,
    });
    const challenge = vi.fn(
      async () =>
        new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        }),
    );

    await expect(
      kimiAdapter.collect(
        { provider: "kimi", apiKey: "sk-kimi-test" },
        { now: 1_700_000_000, fetch: challenge as typeof fetch, browser: {} as Fetcher },
      ),
    ).rejects.toMatchObject({ code: "BROWSER_FALLBACK_FAILED", retryable: false });
    expect(close).toHaveBeenCalledTimes(1);

    launchBrowserMock.mockClear();
    await expect(
      kimiAdapter.collect(
        { provider: "kimi", apiKey: "sk-kimi-test" },
        {
          now: 1_700_000_000,
          fetch: challenge as typeof fetch,
          browser: {} as Fetcher,
          browserFallbackDisabledUntil: 1_700_003_600,
        },
      ),
    ).rejects.toMatchObject({ code: "BROWSER_FALLBACK_COOLDOWN", retryable: false });
    expect(launchBrowserMock).not.toHaveBeenCalled();
  });

  it.each([
    ["platform_cn", "https://api.moonshot.cn/v1/users/me/balance", "CNY"],
    ["platform_global", "https://api.moonshot.ai/v1/users/me/balance", "USD"],
  ] as const)("解析 Kimi 开放平台 %s 可用余额", async (mode, expectedUrl, currency) => {
    const fetcher = vi.fn(async () =>
      Response.json({
        code: 0,
        data: {
          available_balance: 49.58894,
          voucher_balance: 46.58893,
          cash_balance: 3.00001,
        },
        scode: "0x0",
        status: true,
      }),
    );
    const result = await kimiAdapter.collect(
      { provider: "kimi", apiKey: "sk-platform-test", mode: mode as KimiCredentialMode },
      { now: 1_700_000_000, fetch: fetcher as typeof fetch },
    );
    expect(fetcher).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(result.snapshot.metrics).toEqual([
      {
        key: "kimi-platform-available-balance",
        label: "可用余额",
        kind: "balance",
        unit: currency,
        value: 49.58894,
      },
      {
        key: "kimi-platform-voucher-balance",
        label: "代金券余额",
        kind: "balance",
        unit: currency,
        value: 46.58893,
      },
      {
        key: "kimi-platform-cash-balance",
        label: "现金余额",
        kind: "balance",
        unit: currency,
        value: 3.00001,
      },
    ]);
    expect(result.snapshot.source.adapterVersion).toBe("kimi/5");
  });

  it("将 ZenMux 422 按限流处理并读取 Retry-After", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "rate limited" }, { status: 422, headers: { "retry-after": "30" } }),
    ) as unknown as typeof fetch;
    await expect(
      zenmuxAdapter.collect(
        { provider: "zenmux", apiKey: "sk-mg-v1-test" },
        { now: 1_700_000_000, fetch: fetcher },
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 30,
    });
  });
});
