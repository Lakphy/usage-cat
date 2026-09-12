import type { UsageMetric } from "@/shared/usage";
import { AdapterError } from "@/worker/errors";

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => asRecord(current)[key], value);
}

export function firstValue(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const found = atPath(value, path);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function firstNumber(value: unknown, paths: string[]): number | undefined {
  return numberValue(firstValue(value, paths));
}

export function firstString(value: unknown, paths: string[]): string | undefined {
  const found = firstValue(value, paths);
  return typeof found === "string" && found.trim() ? found.trim() : undefined;
}

export function firstBoolean(value: unknown, paths: string[]): boolean | undefined {
  const found = firstValue(value, paths);
  return typeof found === "boolean" ? found : undefined;
}

export function toEpoch(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric !== undefined)
    return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

export function percentageMetric(
  key: string,
  label: string,
  percentage: number | undefined,
  resetAt?: number,
  periodStart?: number,
): UsageMetric | undefined {
  if (percentage === undefined) return undefined;
  const safe = Math.min(100, Math.max(0, percentage));
  return {
    key,
    label,
    kind: "quota_window",
    unit: "%",
    used: safe,
    limit: 100,
    remaining: Math.max(0, 100 - safe),
    percentage: safe,
    resetAt,
    periodStart,
    periodEnd: resetAt,
  };
}

export function absoluteMetric(options: {
  key: string;
  label: string;
  kind?: UsageMetric["kind"];
  unit: string;
  used?: number;
  limit?: number;
  remaining?: number;
  value?: number;
  periodStart?: number;
  periodEnd?: number;
  resetAt?: number;
}): UsageMetric | undefined {
  if (options.used === undefined && options.value === undefined) return undefined;
  const percentage =
    options.used !== undefined && options.limit !== undefined && options.limit > 0
      ? Math.min(100, Math.max(0, (options.used / options.limit) * 100))
      : undefined;
  const remaining =
    options.remaining ??
    (options.used !== undefined && options.limit !== undefined
      ? Math.max(0, options.limit - options.used)
      : undefined);
  return { kind: "billing_counter", ...options, remaining, percentage } as UsageMetric;
}

export async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  options: {
    timeoutMs?: number;
    authStatuses?: number[];
    retryStatuses?: number[];
    rateLimitStatuses?: number[];
    oauthTokenEndpoint?: boolean;
    maxResponseBytes?: number;
  } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new AdapterError("NETWORK_ERROR", "上游请求超时", true);
    }
    throw new AdapterError("NETWORK_ERROR", "无法连接上游服务", true);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new AdapterError(
      "UPSTREAM_SCHEMA_CHANGED",
      "上游返回了不允许的重定向，请升级适配器",
      false,
      true,
    );
  }
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new AdapterError(
      "UPSTREAM_SCHEMA_CHANGED",
      "上游响应体积异常，请升级适配器",
      false,
      true,
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new AdapterError("NETWORK_ERROR", "读取上游响应失败", true);
  }
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
    throw new AdapterError(
      "UPSTREAM_SCHEMA_CHANGED",
      "上游响应体积异常，请升级适配器",
      false,
      true,
    );
  }

  let parsed: unknown;
  if (body.trim()) {
    try {
      parsed = JSON.parse(body);
    } catch {
      if (response.ok) {
        throw new AdapterError("UPSTREAM_SCHEMA_CHANGED", "上游返回的不是 JSON", false, true);
      }
    }
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterNumber = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  const retryAfterDate = retryAfterHeader ? Date.parse(retryAfterHeader) : Number.NaN;
  const retryAfterSeconds = Number.isFinite(retryAfterNumber)
    ? Math.max(1, Math.min(3600, Math.ceil(retryAfterNumber)))
    : Number.isFinite(retryAfterDate)
      ? Math.max(1, Math.min(3600, Math.ceil((retryAfterDate - Date.now()) / 1000)))
      : undefined;
  const authStatuses = new Set(options.authStatuses ?? [401, 403]);
  const rateLimitStatuses = new Set(options.rateLimitStatuses ?? [429]);
  const retryStatuses = new Set(options.retryStatuses ?? [408, 425]);
  const oauthError = firstString(parsed, ["error.code", "error", "code"]);

  if (
    authStatuses.has(response.status) ||
    (options.oauthTokenEndpoint &&
      response.status === 400 &&
      [
        "invalid_grant",
        "invalid_token",
        "refresh_token_expired",
        "refresh_token_reused",
        "refresh_token_invalidated",
      ].includes(oauthError?.toLowerCase() ?? ""))
  ) {
    const safeAuthCode =
      oauthError && /^[a-z0-9_.-]{1,80}$/i.test(oauthError) ? `，${oauthError}` : "";
    console.warn("upstream_auth_failed", {
      host: new URL(url).host,
      status: response.status,
      code: safeAuthCode ? oauthError : undefined,
      ray: response.headers.get("cf-ray") ?? undefined,
    });
    throw new AdapterError(
      "AUTH_EXPIRED",
      `凭据验证失败（上游 ${response.status}${safeAuthCode}），请检查凭据类型与区域`,
      false,
      true,
    );
  }
  if (rateLimitStatuses.has(response.status)) {
    throw new AdapterError("RATE_LIMITED", "上游请求频率受限", true, false, retryAfterSeconds);
  }
  if (retryStatuses.has(response.status) || response.status >= 500) {
    throw new AdapterError("UPSTREAM_UNAVAILABLE", `上游暂时不可用（${response.status}）`, true);
  }
  if (!response.ok) {
    throw new AdapterError("UPSTREAM_SCHEMA_CHANGED", `上游返回了 ${response.status}`, false, true);
  }
  return parsed ?? {};
}

export function requireMetrics<T>(metrics: Array<T | undefined>): T[] {
  const available = metrics.filter((metric): metric is T => metric !== undefined);
  if (available.length === 0) {
    throw new AdapterError("UPSTREAM_SCHEMA_CHANGED", "未能识别上游用量字段", false, true);
  }
  return available;
}

export function decodeJwtPayload(token?: string): UnknownRecord {
  if (!token) return {};
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return {};
    const unpadded = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const normalized = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");
    return asRecord(JSON.parse(atob(normalized)));
  } catch {
    return {};
  }
}

export function jwtExpiration(token?: string): number | undefined {
  return firstNumber(decodeJwtPayload(token), ["exp"]);
}

export function safeMetricKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return key || "unknown";
}
