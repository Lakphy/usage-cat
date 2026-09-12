import { snapshotPayloadSchema } from "@/shared/usage";
import {
  absoluteMetric,
  decodeJwtPayload,
  firstNumber,
  firstString,
  firstValue,
  jwtExpiration,
  numberValue,
  percentageMetric,
  requestJson,
  requireMetrics,
  toEpoch,
} from "@/worker/adapters/helpers";
import type { UsageAdapter } from "@/worker/adapters/types";
import { AdapterError } from "@/worker/errors";

const ISSUER = "https://auth.x.ai";
const API_ROOT = "https://cli-chat-proxy.grok.com/v1";
const GROK_CLIENT_VERSION = "1.0.24";

function centValue(root: unknown, paths: string[]): number | undefined {
  const raw = firstValue(root, paths);
  const direct = numberValue(raw);
  if (direct !== undefined) return direct;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return firstNumber(raw, ["val"]) ?? 0;
  }
  return undefined;
}

async function optionalMetadata(request: Promise<unknown>): Promise<unknown> {
  try {
    return await request;
  } catch {
    return {};
  }
}

export const grokAdapter: UsageAdapter<"grok"> = {
  provider: "grok",

  async prepareCredential(input, context) {
    const expiresAt = input.expiresAt ?? jwtExpiration(input.accessToken);
    if (!context.forceRefresh) {
      if (!expiresAt) return input;
      if (expiresAt >= context.now + 300) {
        return expiresAt === input.expiresAt ? input : { ...input, expiresAt };
      }
    }
    if (!input.refreshToken || input.issuer !== ISSUER || !input.clientId) {
      throw new AdapterError("AUTH_EXPIRED", "Grok 凭据已过期且无法刷新", false, true);
    }

    const discovery = await requestJson(
      context.fetch,
      `${ISSUER}/.well-known/openid-configuration`,
      {
        headers: { accept: "application/json" },
      },
    );
    const tokenEndpoint = firstString(discovery, ["token_endpoint"]);
    let validEndpoint = false;
    try {
      const parsed = new URL(tokenEndpoint ?? "");
      validEndpoint = parsed.origin === ISSUER && parsed.protocol === "https:";
    } catch {
      validEndpoint = false;
    }
    if (!tokenEndpoint || !validEndpoint) {
      throw new AdapterError("UPSTREAM_SCHEMA_CHANGED", "Grok OIDC 配置无效", false, true);
    }

    const refreshBody: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
    };
    if (input.principalType) refreshBody.principal_type = input.principalType;
    if (input.principalId) refreshBody.principal_id = input.principalId;
    const refreshed = await requestJson(
      context.fetch,
      tokenEndpoint,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(refreshBody),
      },
      { oauthTokenEndpoint: true },
    );
    const accessToken = firstString(refreshed, ["access_token"]);
    if (!accessToken) {
      throw new AdapterError("AUTH_EXPIRED", "Grok 刷新响应缺少 access_token", false, true);
    }
    return {
      ...input,
      accessToken,
      refreshToken: firstString(refreshed, ["refresh_token"]) ?? input.refreshToken,
      expiresAt:
        jwtExpiration(accessToken) ??
        context.now + (firstNumber(refreshed, ["expires_in"]) ?? 3600),
    };
  },

  async collect(credential, context) {
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${credential.accessToken}`,
      "x-grok-client-mode": "headless",
      "x-grok-client-version": GROK_CLIENT_VERSION,
      "x-userid": credential.userId,
      "x-xai-token-auth": "xai-grok-cli",
    };
    const [billing, settings] = await Promise.all([
      requestJson(context.fetch, `${API_ROOT}/billing?format=credits`, { headers }),
      optionalMetadata(requestJson(context.fetch, `${API_ROOT}/settings`, { headers })),
    ]);
    const config = firstValue(billing, ["config"]) ?? billing;
    const periodStart = toEpoch(
      firstValue(config, ["currentPeriod.start", "billingPeriodStart", "billing_period_start"]),
    );
    const periodEnd = toEpoch(
      firstValue(config, ["currentPeriod.end", "billingPeriodEnd", "billing_period_end"]),
    );
    const legacyLimit = centValue(config, ["monthlyLimit", "monthly_limit"]);
    const legacyUsed = centValue(config, ["used"]);
    const onDemandLimit = centValue(config, ["onDemandCap", "on_demand_cap"]);
    const onDemandUsed = centValue(config, ["onDemandUsed", "on_demand_used"]);
    const metrics = requireMetrics([
      percentageMetric(
        "grok-included-credits",
        "套餐 Credits 额度",
        firstNumber(config, ["creditUsagePercent", "credit_usage_percent"]),
        periodEnd,
        periodStart,
      ),
      absoluteMetric({
        key: "grok-included-legacy",
        label: "套餐 Credits 额度（兼容）",
        kind: legacyLimit !== undefined && legacyLimit > 0 ? "quota_window" : "billing_counter",
        unit: "USD cents",
        used: legacyUsed ?? (legacyLimit !== undefined ? 0 : undefined),
        limit: legacyLimit,
        periodStart,
        periodEnd,
        resetAt: periodEnd,
      }),
      absoluteMetric({
        key: "grok-on-demand",
        label: onDemandLimit !== undefined ? "按量付费额度" : "按量付费用量",
        kind: onDemandLimit !== undefined && onDemandLimit > 0 ? "quota_window" : "billing_counter",
        unit: "USD cents",
        used: onDemandUsed ?? (onDemandLimit !== undefined ? 0 : undefined),
        limit: onDemandLimit,
        periodStart,
        periodEnd,
        resetAt: periodEnd,
      }),
      (() => {
        const balance = centValue(config, ["prepaidBalance", "prepaid_balance"]);
        return balance === undefined
          ? undefined
          : {
              key: "grok-prepaid-balance",
              label: "预付 Credits 余额",
              kind: "balance" as const,
              unit: "USD cents",
              value: balance,
            };
      })(),
    ]);
    const claims = decodeJwtPayload(credential.accessToken);

    return {
      snapshot: snapshotPayloadSchema.parse({
        schemaVersion: 1,
        provider: "grok",
        capturedAt: context.now,
        identity: {
          username:
            credential.username ?? firstString(settings, ["user.name", "username", "account.name"]),
          email:
            credential.email ??
            firstString(settings, ["user.email", "email", "account.email"]) ??
            firstString(claims, ["email"]),
        },
        plan:
          firstString(settings, [
            "subscription_tier_display",
            "subscriptionTierDisplay",
            "subscription_tier",
            "subscriptionTier",
          ]) ??
          firstString(billing, ["subscriptionTier", "subscription_tier"]) ??
          firstString(claims, ["tier"]),
        metrics,
        source: { adapterVersion: "grok/3" },
      }),
    };
  },
};
