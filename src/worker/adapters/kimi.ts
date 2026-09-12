import puppeteer from "@cloudflare/puppeteer";
import { snapshotPayloadSchema, type UsageMetric } from "@/shared/usage";
import {
  absoluteMetric,
  asRecord,
  firstBoolean,
  firstNumber,
  firstString,
  firstValue,
  requestJson,
  requireMetrics,
  safeMetricKey,
  toEpoch,
} from "@/worker/adapters/helpers";
import type { AdapterContext, UsageAdapter } from "@/worker/adapters/types";
import { AdapterError } from "@/worker/errors";

const KIMI_ENDPOINTS = {
  code_cn: {
    kind: "subscription",
    url: "https://api.kimi.com/coding/v1/usages",
    plan: "Kimi Code（中国区）",
  },
  code_global: {
    kind: "subscription",
    url: "https://api.kimi.ai/coding/v1/usages",
    plan: "Kimi Code（海外区）",
  },
  platform_cn: {
    kind: "balance",
    url: "https://api.moonshot.cn/v1/users/me/balance",
    plan: "Kimi 开放平台（中国区）",
    currency: "CNY",
  },
  platform_global: {
    kind: "balance",
    url: "https://api.moonshot.ai/v1/users/me/balance",
    plan: "Kimi API Platform（海外区）",
    currency: "USD",
  },
} as const;
const FIXED_POINT_CENTS = 1_000_000;
const MAX_BROWSER_RESPONSE_BYTES = 1_000_000;

interface WindowInfo {
  duration: number;
  unit: "minute" | "hour" | "day" | "week";
}

function parseWindow(value: unknown): WindowInfo | undefined {
  const duration = firstNumber(value, ["duration"]);
  const rawUnit = firstString(value, ["timeUnit", "time_unit"]);
  const unitMap: Record<string, WindowInfo["unit"]> = {
    TIME_UNIT_MINUTE: "minute",
    TIME_UNIT_HOUR: "hour",
    TIME_UNIT_DAY: "day",
    TIME_UNIT_WEEK: "week",
  };
  const unit = rawUnit ? unitMap[rawUnit] : undefined;
  if (!duration || !unit) return undefined;
  if (unit === "minute" && duration >= 60 && duration % 60 === 0) {
    return { duration: duration / 60, unit: "hour" };
  }
  return { duration, unit };
}

function windowName(window: WindowInfo | undefined, fallback: string): string {
  if (!window) return fallback;
  const units = { minute: "分钟", hour: "小时", day: "天", week: "周" };
  return `${window.duration} ${units[window.unit]}额度`;
}

function quotaMetric(detail: unknown, key: string, label: string): UsageMetric | undefined {
  const resetAt = toEpoch(firstValue(detail, ["resetTime", "reset_time", "resetAt"]));
  const limit = firstNumber(detail, ["limit"]);
  const reportedRemaining = firstNumber(detail, ["remaining"]);
  const used =
    firstNumber(detail, ["used"]) ??
    (limit !== undefined && reportedRemaining !== undefined
      ? Math.max(0, limit - reportedRemaining)
      : undefined);
  return absoluteMetric({
    key,
    label,
    kind: "quota_window",
    unit: "quota",
    used,
    limit,
    remaining: reportedRemaining,
    resetAt,
    periodEnd: resetAt,
  });
}

function fixedPointToCents(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cents = value / FIXED_POINT_CENTS;
  if (cents > 0 && cents < 1) return 1;
  return Math.round(cents);
}

function platformBalanceMetrics(data: unknown, currency: "CNY" | "USD"): UsageMetric[] {
  const responseCode = firstNumber(data, ["code"]);
  const responseStatus = firstBoolean(data, ["status"]);
  if ((responseCode !== undefined && responseCode !== 0) || responseStatus === false) {
    throw new AdapterError("UPSTREAM_UNAVAILABLE", "Kimi 开放平台返回业务错误，请稍后重试", true);
  }

  const available = firstNumber(data, ["data.available_balance"]);
  if (available === undefined) {
    throw new AdapterError("UPSTREAM_SCHEMA_CHANGED", "Kimi 开放平台响应缺少可用余额", false, true);
  }

  const metrics: UsageMetric[] = [
    {
      key: "kimi-platform-available-balance",
      label: "可用余额",
      kind: "balance",
      unit: currency,
      value: available,
    },
  ];
  const voucher = firstNumber(data, ["data.voucher_balance"]);
  if (voucher !== undefined) {
    metrics.push({
      key: "kimi-platform-voucher-balance",
      label: "代金券余额",
      kind: "balance",
      unit: currency,
      value: voucher,
    });
  }
  const cash = firstNumber(data, ["data.cash_balance"]);
  if (cash !== undefined) {
    metrics.push({
      key: "kimi-platform-cash-balance",
      label: "现金余额",
      kind: "balance",
      unit: currency,
      value: cash,
    });
  }
  return metrics;
}

async function browserFetch(
  browserBinding: Fetcher,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    delete headers["user-agent"];
    await page.setExtraHTTPHeaders(headers);
    const upstream = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (!upstream) throw new Error("Browser Run 没有返回导航响应");
    const body = await upstream.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BROWSER_RESPONSE_BYTES) {
      throw new Error("Browser Run 上游响应体积异常");
    }
    const upstreamHeaders = upstream.headers();
    const responseHeaders = new Headers();
    for (const name of ["content-type", "retry-after", "cf-ray"]) {
      const value = upstreamHeaders[name];
      if (value) responseHeaders.set(name, value);
    }
    return new Response(body, { status: upstream.status(), headers: responseHeaders });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function safeBrowserError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : "未知错误";
  return raw
    .replace(/(?:https?|wss?):\/\/\S+/gi, "<url>")
    .replace(/\bsk-[a-z0-9_-]+\b/gi, "<redacted>")
    .replace(/\b[a-z0-9_-]{32,}\b/gi, "<redacted>")
    .slice(0, 180);
}

async function browserFallback(
  browserBinding: Fetcher,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const startedAt = Date.now();
  const host = new URL(url).host;
  try {
    const response = await browserFetch(browserBinding, url, init);
    console.info("kimi_browser_fallback_completed", {
      host,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    const diagnostic = safeBrowserError(error);
    console.warn("kimi_browser_fallback_failed", {
      host,
      durationMs: Date.now() - startedAt,
      diagnostic,
    });
    throw new AdapterError(
      "BROWSER_FALLBACK_FAILED",
      `Kimi Browser Run 回退失败（${diagnostic}）`,
      false,
    );
  }
}

function isCloudflareChallenge(response: Response): boolean {
  return response.status === 403 && response.headers.get("cf-mitigated") === "challenge";
}

function assertBrowserFallbackAvailable(
  context: AdapterContext,
): asserts context is AdapterContext & {
  browser: Fetcher;
} {
  if (!context.browser) {
    throw new AdapterError("NETWORK_ERROR", "Kimi Browser Run 未配置", true);
  }
  if (
    context.browserFallbackDisabledUntil !== undefined &&
    context.browserFallbackDisabledUntil > context.now
  ) {
    throw new AdapterError(
      "BROWSER_FALLBACK_COOLDOWN",
      "Kimi Browser Run 暂时熔断，将在下个刷新周期重试",
      false,
    );
  }
}

function kimiFetcher(context: AdapterContext): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let direct: Response;
    try {
      direct = await context.fetch(input, init);
    } catch (error) {
      if (!context.browser || (context.syncAttempt ?? 1) < 2) throw error;
      assertBrowserFallbackAvailable(context);
      console.info("kimi_browser_fallback", {
        host: new URL(url).host,
        reason: "repeated_network_error",
        attempt: context.syncAttempt,
      });
      return browserFallback(context.browser, url, init);
    }
    if (!isCloudflareChallenge(direct) || !context.browser) return direct;
    assertBrowserFallbackAvailable(context);
    console.info("kimi_browser_fallback", {
      host: new URL(url).host,
      reason: "cloudflare_challenge",
      status: direct.status,
    });
    return browserFallback(context.browser, url, init);
  }) as typeof fetch;
}

export const kimiAdapter: UsageAdapter<"kimi"> = {
  provider: "kimi",
  async collect(credential, context) {
    const endpoint = KIMI_ENDPOINTS[credential.mode ?? "code_cn"];
    const data = await requestJson(
      kimiFetcher(context),
      endpoint.url,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential.apiKey}`,
          "user-agent": "usage-cat/1.0 (+https://usage.lakphy.me)",
        },
      },
      { authStatuses: [401], rateLimitStatuses: [403, 429], retryStatuses: [402, 408, 425] },
    );

    if (endpoint.kind === "balance") {
      return {
        snapshot: snapshotPayloadSchema.parse({
          schemaVersion: 1,
          provider: "kimi",
          capturedAt: context.now,
          identity: {},
          plan: endpoint.plan,
          metrics: platformBalanceMetrics(data, endpoint.currency),
          source: { adapterVersion: "kimi/5" },
        }),
      };
    }

    const metrics: UsageMetric[] = [];
    const summary = firstValue(data, ["usage"]);
    const weekly = quotaMetric(summary, "kimi-weekly", "每周额度");
    if (weekly) metrics.push(weekly);

    const limits = firstValue(data, ["limits"]);
    if (Array.isArray(limits)) {
      for (const [index, item] of limits.slice(0, 10).entries()) {
        const record = asRecord(item);
        const window = parseWindow(record.window);
        const name = firstString(record, ["name"]);
        const identity = window ? `${window.duration}-${window.unit}` : (name ?? String(index + 1));
        const metric = quotaMetric(
          record.detail,
          `kimi-${safeMetricKey(identity)}`,
          name ?? windowName(window, `额度窗口 ${index + 1}`),
        );
        if (metric && !metrics.some((candidate) => candidate.key === metric.key))
          metrics.push(metric);
      }
    }

    const wallet = firstValue(data, ["boosterWallet"]);
    const balance = firstValue(wallet, ["balance"]);
    const isBooster = firstString(balance, ["type"]) === "BOOSTER";
    const totalCents = isBooster ? fixedPointToCents(firstNumber(balance, ["amount"])) : undefined;
    const balanceCents = isBooster
      ? (fixedPointToCents(firstNumber(balance, ["amountLeft"])) ?? 0)
      : undefined;
    const currency =
      firstString(wallet, ["monthlyChargeLimit.currency", "monthlyUsed.currency"]) ?? "USD";
    if (totalCents !== undefined && totalCents > 0 && balanceCents !== undefined) {
      metrics.push({
        key: "kimi-booster-balance",
        label: "Booster 余额",
        kind: "balance",
        unit: `${currency} cents`,
        value: balanceCents,
      });
      const monthlyUsed = firstNumber(wallet, ["monthlyUsed.priceInCents"]);
      const monthlyLimitEnabled = firstBoolean(wallet, ["monthlyChargeLimitEnabled"]);
      const monthlyLimit = monthlyLimitEnabled
        ? firstNumber(wallet, ["monthlyChargeLimit.priceInCents"])
        : undefined;
      const monthlyMetric = absoluteMetric({
        key: "kimi-booster-monthly",
        label: monthlyLimit !== undefined ? "Booster 月度额度" : "Booster 月度用量",
        kind: monthlyLimit !== undefined && monthlyLimit > 0 ? "quota_window" : "billing_counter",
        unit: `${currency} cents`,
        used: monthlyUsed,
        limit: monthlyLimit,
      });
      if (monthlyMetric) metrics.push(monthlyMetric);
    }

    return {
      snapshot: snapshotPayloadSchema.parse({
        schemaVersion: 1,
        provider: "kimi",
        capturedAt: context.now,
        identity: {},
        plan: firstString(data, ["membership", "plan"]) ?? endpoint.plan,
        metrics: requireMetrics(metrics),
        source: { adapterVersion: "kimi/5" },
      }),
    };
  },
};
