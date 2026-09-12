import { snapshotPayloadSchema } from "@/shared/usage";
import {
  absoluteMetric,
  decodeJwtPayload,
  firstBoolean,
  firstNumber,
  firstString,
  firstValue,
  jwtExpiration,
  percentageMetric,
  requestJson,
  requireMetrics,
  toEpoch,
} from "@/worker/adapters/helpers";
import type { AdapterContext, UsageAdapter } from "@/worker/adapters/types";
import { AdapterError } from "@/worker/errors";

const API_ROOT = "https://api2.cursor.sh";

function dashboardRequest(context: AdapterContext, accessToken: string, method: string) {
  return requestJson(context.fetch, `${API_ROOT}/aiserver.v1.DashboardService/${method}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "connect-protocol-version": "1",
      "content-type": "application/json",
    },
    body: "{}",
  });
}

async function optionalMetadata(request: Promise<unknown>): Promise<unknown> {
  try {
    return await request;
  } catch {
    return {};
  }
}

export const cursorAdapter: UsageAdapter<"cursor"> = {
  provider: "cursor",

  async prepareCredential(input, context) {
    const expiresAt = input.accessTokenExpiresAt ?? jwtExpiration(input.accessToken);
    if (!context.forceRefresh && input.accessToken && expiresAt && expiresAt >= context.now + 300) {
      return expiresAt === input.accessTokenExpiresAt
        ? input
        : { ...input, accessTokenExpiresAt: expiresAt };
    }
    const exchange = await requestJson(
      context.fetch,
      `${API_ROOT}/auth/exchange_user_api_key`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
      { authStatuses: [401, 403] },
    );
    const accessToken = firstString(exchange, ["accessToken", "access_token", "token"]);
    if (!accessToken) {
      throw new AdapterError("AUTH_EXPIRED", "Cursor 密钥交换响应缺少令牌", false, true);
    }
    return {
      ...input,
      accessToken,
      accessTokenExpiresAt:
        jwtExpiration(accessToken) ??
        toEpoch(firstValue(exchange, ["expiresAt", "expires_at"])) ??
        context.now + (firstNumber(exchange, ["expiresIn", "expires_in"]) ?? 900),
    };
  },

  async collect(credential, context) {
    if (!credential.accessToken) {
      throw new AdapterError("AUTH_EXPIRED", "Cursor 访问令牌不可用", false, true);
    }
    const [usage, plan, me, sandUsage] = await Promise.all([
      dashboardRequest(context, credential.accessToken, "GetCurrentPeriodUsage"),
      optionalMetadata(dashboardRequest(context, credential.accessToken, "GetPlanInfo")),
      optionalMetadata(dashboardRequest(context, credential.accessToken, "GetMe")),
      optionalMetadata(dashboardRequest(context, credential.accessToken, "GetSandUsageStatus")),
    ]);

    const planUsage = firstValue(usage, ["planUsage", "plan_usage"]);
    const limitCents =
      firstNumber(planUsage, ["limit"]) ??
      firstNumber(usage, ["spendLimitCents", "usage.spendLimitCents"]);
    const remainingCents =
      firstNumber(planUsage, ["remaining"]) ?? firstNumber(usage, ["remainingSpendCents"]);
    const reportedUsedCents =
      firstNumber(planUsage, ["totalSpend", "total_spend"]) ??
      firstNumber(usage, ["totalSpendCents", "usage.totalSpendCents"]);
    const usedCents =
      reportedUsedCents ??
      (limitCents !== undefined && remainingCents !== undefined
        ? Math.max(0, limitCents - remainingCents)
        : undefined);
    const periodStart = toEpoch(
      firstValue(usage, ["billingCycleStart", "billing_cycle_start", "periodStart"]),
    );
    const periodEnd = toEpoch(
      firstValue(usage, ["billingCycleEnd", "billing_cycle_end", "periodEnd", "resetAt"]),
    );
    const usageBased = firstValue(usage, ["spendLimitUsage", "spend_limit_usage"]);
    const usageBasedLimit = firstNumber(usageBased, [
      "overallLimit",
      "overall_limit",
      "individualLimit",
      "individual_limit",
      "pooledLimit",
      "pooled_limit",
    ]);
    const reportedUsageBasedUsed = firstNumber(usageBased, [
      "totalSpend",
      "total_spend",
      "overallUsed",
      "overall_used",
      "individualUsed",
      "individual_used",
      "pooledUsed",
      "pooled_used",
    ]);
    const usageBasedRemaining = firstNumber(usageBased, [
      "overallRemaining",
      "overall_remaining",
      "individualRemaining",
      "individual_remaining",
      "pooledRemaining",
      "pooled_remaining",
    ]);
    const usageBasedUsed =
      reportedUsageBasedUsed ??
      (usageBasedLimit !== undefined && usageBasedRemaining !== undefined
        ? Math.max(0, usageBasedLimit - usageBasedRemaining)
        : undefined);
    const cursorModelsPercentage = firstNumber(planUsage, ["autoPercentUsed", "auto_percent_used"]);
    const otherModelsPercentage = firstNumber(planUsage, ["apiPercentUsed", "api_percent_used"]);
    const totalPercentage = firstNumber(planUsage, ["totalPercentUsed", "total_percent_used"]);
    const autoLimit = firstNumber(usage, ["planUsage.autoLimit", "plan_usage.auto_limit"]);
    const apiLimit = firstNumber(usage, ["planUsage.apiLimit", "plan_usage.api_limit"]);
    const hasModelBuckets =
      cursorModelsPercentage !== undefined || otherModelsPercentage !== undefined;
    const includedMetrics = hasModelBuckets
      ? [
          percentageMetric(
            "cursor-models",
            "Cursor Models",
            cursorModelsPercentage,
            periodEnd,
            periodStart,
          ),
          percentageMetric(
            "cursor-other-models",
            "Other Models",
            otherModelsPercentage,
            periodEnd,
            periodStart,
          ),
        ]
      : [
          percentageMetric(
            "cursor-plan-usage-percent",
            "套餐内本账期额度",
            totalPercentage,
            periodEnd,
            periodStart,
          ) ??
            absoluteMetric({
              key: "cursor-plan-usage",
              label: "套餐内本账期额度",
              kind: limitCents !== undefined && limitCents > 0 ? "quota_window" : "billing_counter",
              unit: "USD cents",
              used: usedCents,
              limit: limitCents,
              remaining: remainingCents,
              periodStart,
              periodEnd,
              resetAt: periodEnd,
            }),
          absoluteMetric({
            key: "cursor-auto-usage",
            label: autoLimit !== undefined ? "Auto 模型额度" : "Auto 模型用量",
            kind: autoLimit !== undefined && autoLimit > 0 ? "quota_window" : "billing_counter",
            unit: "USD cents",
            used: firstNumber(usage, ["planUsage.autoSpend", "plan_usage.auto_spend"]),
            limit: autoLimit,
            periodStart,
            periodEnd,
            resetAt: periodEnd,
          }),
          absoluteMetric({
            key: "cursor-api-usage",
            label: apiLimit !== undefined ? "API 模型额度" : "API 模型用量",
            kind: apiLimit !== undefined && apiLimit > 0 ? "quota_window" : "billing_counter",
            unit: "USD cents",
            used: firstNumber(usage, ["planUsage.apiSpend", "plan_usage.api_spend"]),
            limit: apiLimit,
            periodStart,
            periodEnd,
            resetAt: periodEnd,
          }),
        ];
    const grokBotHasQuota = firstBoolean(sandUsage, [
      "hasNonZeroIncludedLimit",
      "has_non_zero_included_limit",
    ]);
    const grokBotPeriodStart = toEpoch(
      firstValue(sandUsage, ["currentPeriodStart", "current_period_start"]),
    );
    const grokBotResetAt = toEpoch(
      firstValue(sandUsage, ["nextResetTimestampUtc", "next_reset_timestamp_utc"]),
    );
    const metrics = requireMetrics([
      ...includedMetrics,
      percentageMetric(
        "cursor-grok-bot-weekly",
        "Grok Bot 周额度",
        grokBotHasQuota === false
          ? undefined
          : firstNumber(sandUsage, ["usagePercent", "usage_percent"]),
        grokBotResetAt,
        grokBotPeriodStart,
      ),
      absoluteMetric({
        key: "cursor-usage-based",
        label: usageBasedLimit !== undefined ? "按量付费额度" : "按量付费用量",
        kind:
          usageBasedLimit !== undefined && usageBasedLimit > 0 ? "quota_window" : "billing_counter",
        unit: "USD cents",
        used: usageBasedUsed,
        limit: usageBasedLimit,
        remaining: usageBasedRemaining,
        periodStart,
        periodEnd,
        resetAt: periodEnd,
      }),
    ]);

    const claims = decodeJwtPayload(credential.accessToken);
    return {
      snapshot: snapshotPayloadSchema.parse({
        schemaVersion: 1,
        provider: "cursor",
        capturedAt: context.now,
        identity: {
          username: firstString(me, ["name", "username", "user.name"]),
          email: firstString(me, ["email", "user.email"]) ?? firstString(claims, ["email"]),
        },
        plan: firstString(plan, [
          "planInfo.planName",
          "plan_info.plan_name",
          "planName",
          "plan.name",
        ]),
        metrics,
        source: { adapterVersion: "cursor/4" },
      }),
    };
  },
};
