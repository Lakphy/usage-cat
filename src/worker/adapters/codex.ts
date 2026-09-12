import { snapshotPayloadSchema, type UsageMetric } from "@/shared/usage";
import {
  absoluteMetric,
  asRecord,
  decodeJwtPayload,
  firstNumber,
  firstString,
  firstValue,
  jwtExpiration,
  percentageMetric,
  requestJson,
  requireMetrics,
  safeMetricKey,
  toEpoch,
} from "@/worker/adapters/helpers";
import type { UsageAdapter } from "@/worker/adapters/types";
import { AdapterError } from "@/worker/errors";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function windowLabel(fallback: string, window: unknown): string {
  const seconds = firstNumber(window, ["limit_window_seconds", "limitWindowSeconds"]);
  if (!seconds || seconds <= 0) return fallback;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} 天窗口`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时窗口`;
  return fallback;
}

function windowPercentage(window: unknown): number | undefined {
  const value = firstNumber(window, ["used_percent", "usedPercent"]);
  if (value !== undefined) return value;
  return window !== null && typeof window === "object" && !Array.isArray(window) ? 0 : undefined;
}

function quotaMetrics(root: unknown, keyPrefix: string, labelPrefix = ""): UsageMetric[] {
  const primary = firstValue(root, ["primary_window", "primaryWindow"]);
  const secondary = firstValue(root, ["secondary_window", "secondaryWindow"]);
  return requireMetrics([
    percentageMetric(
      `${keyPrefix}-primary`,
      `${labelPrefix}${windowLabel("主窗口", primary)}`,
      windowPercentage(primary),
      toEpoch(firstValue(primary, ["reset_at", "resetAt"])),
    ),
    percentageMetric(
      `${keyPrefix}-secondary`,
      `${labelPrefix}${windowLabel("次窗口", secondary)}`,
      windowPercentage(secondary),
      toEpoch(firstValue(secondary, ["reset_at", "resetAt"])),
    ),
  ]);
}

export const codexAdapter: UsageAdapter<"codex"> = {
  provider: "codex",

  async prepareCredential(input, context) {
    const expiresAt = input.expiresAt ?? jwtExpiration(input.accessToken);
    if (!context.forceRefresh && expiresAt && expiresAt >= context.now + 300) {
      return expiresAt === input.expiresAt ? input : { ...input, expiresAt };
    }
    const refreshed = await requestJson(
      context.fetch,
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          client_id: CODEX_CLIENT_ID,
        }),
      },
      { oauthTokenEndpoint: true },
    );
    const accessToken = firstString(refreshed, ["access_token"]);
    if (!accessToken) {
      throw new AdapterError("AUTH_EXPIRED", "Codex 刷新响应缺少 access_token", false, true);
    }
    return {
      ...input,
      accessToken,
      refreshToken: firstString(refreshed, ["refresh_token"]) ?? input.refreshToken,
      idToken: firstString(refreshed, ["id_token"]) ?? input.idToken,
      expiresAt:
        jwtExpiration(accessToken) ??
        context.now + (firstNumber(refreshed, ["expires_in"]) ?? 3600),
    };
  },

  async collect(credential, context) {
    const data = await requestJson(context.fetch, USAGE_URL, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential.accessToken}`,
        "chatgpt-account-id": credential.accountId,
      },
    });

    const baseRateLimit = firstValue(data, ["rate_limit", "rateLimit"]);
    const metrics = quotaMetrics(baseRateLimit, "codex");
    const additional = firstValue(data, ["additional_rate_limits", "additionalRateLimits"]);
    if (Array.isArray(additional)) {
      for (const item of additional.slice(0, 10)) {
        const record = asRecord(item);
        const name = firstString(record, [
          "limit_name",
          "limitName",
          "metered_feature",
          "meteredFeature",
        ]);
        const limit = firstValue(record, ["rate_limit", "rateLimit"]);
        if (!name || !limit) continue;
        try {
          const additions = quotaMetrics(
            limit,
            `codex-${safeMetricKey(name)}`,
            `${name.slice(0, 70)} · `,
          );
          for (const metric of additions) {
            if (!metrics.some((candidate) => candidate.key === metric.key)) metrics.push(metric);
          }
        } catch (error) {
          if (!(error instanceof AdapterError) || error.code !== "UPSTREAM_SCHEMA_CHANGED") {
            throw error;
          }
        }
      }
    }

    const balance = firstNumber(data, ["credits.balance", "credit_balance", "credits.remaining"]);
    if (balance !== undefined) {
      metrics.push({
        key: "codex-credits",
        label: "Credits 余额",
        kind: "balance",
        unit: "credits",
        used: balance,
        value: balance,
      });
    }
    const individualLimit = firstValue(data, [
      "spend_control.individual_limit",
      "spendControl.individualLimit",
    ]);
    const workspaceLimit = firstNumber(individualLimit, ["limit"]);
    const spendMetric = absoluteMetric({
      key: "codex-spend-control",
      label: "Workspace 额度",
      kind: workspaceLimit !== undefined && workspaceLimit > 0 ? "quota_window" : "billing_counter",
      unit: "credits",
      used: firstNumber(individualLimit, ["used"]),
      limit: workspaceLimit,
      remaining: firstNumber(individualLimit, ["remaining"]),
      resetAt: toEpoch(firstValue(individualLimit, ["reset_at", "resetAt"])),
    });
    if (spendMetric) metrics.push(spendMetric);

    const claims = decodeJwtPayload(credential.idToken ?? credential.accessToken);
    const namespacedClaims = asRecord(claims["https://api.openai.com/auth"]);
    return {
      snapshot: snapshotPayloadSchema.parse({
        schemaVersion: 1,
        provider: "codex",
        capturedAt: context.now,
        identity: {
          username: firstString(claims, ["preferred_username", "name"]),
          email: firstString(claims, ["email"]),
        },
        plan:
          firstString(data, ["plan_type", "planType"]) ??
          firstString(namespacedClaims, ["chatgpt_plan_type"]) ??
          firstString(claims, ["chatgpt_plan_type"]),
        metrics,
        source: { adapterVersion: "codex/3" },
      }),
    };
  },
};
