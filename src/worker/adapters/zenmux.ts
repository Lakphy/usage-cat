import { snapshotPayloadSchema } from "@/shared/usage";
import {
  absoluteMetric,
  firstBoolean,
  firstNumber,
  firstString,
  firstValue,
  percentageMetric,
  requestJson,
  requireMetrics,
  toEpoch,
} from "@/worker/adapters/helpers";
import type { UsageAdapter } from "@/worker/adapters/types";
import { AdapterError } from "@/worker/errors";

const DETAIL_URL = "https://zenmux.ai/api/v1/management/subscription/detail";

function normalizedPercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function flowWindow(data: unknown, kind: "5h" | "7d") {
  const officialPath = kind === "5h" ? "data.quota_5_hour" : "data.quota_7_day";
  const legacyPaths =
    kind === "5h" ? ["data.fiveHour", "data.five_hour"] : ["data.sevenDay", "data.seven_day"];
  const window = firstValue(data, [officialPath, ...legacyPaths]);
  const key = kind === "5h" ? "zenmux-5h" : "zenmux-7d";
  const label = kind === "5h" ? "5 小时 Flow 额度" : "7 天 Flow 额度";
  const resetAt = toEpoch(firstValue(window, ["resets_at", "resetAt", "reset_at"]));
  return (
    absoluteMetric({
      key,
      label,
      kind: "quota_window",
      unit: "flow",
      used: firstNumber(window, ["used_flows", "usedFlow", "used"]),
      limit: firstNumber(window, ["max_flows", "totalFlow", "limit"]),
      remaining: firstNumber(window, ["remaining_flows", "remainingFlow", "remaining"]),
      resetAt,
      periodEnd: resetAt,
    }) ??
    percentageMetric(
      key,
      label,
      normalizedPercent(firstNumber(window, ["usage_percentage", "usedPercent", "percentage"])),
      resetAt,
    )
  );
}

export const zenmuxAdapter: UsageAdapter<"zenmux"> = {
  provider: "zenmux",
  async collect(credential, context) {
    const data = await requestJson(
      context.fetch,
      DETAIL_URL,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential.apiKey}`,
        },
      },
      { rateLimitStatuses: [422, 429] },
    );
    if (firstBoolean(data, ["success"]) === false) {
      throw new AdapterError("UPSTREAM_UNAVAILABLE", "ZenMux 暂未返回订阅详情", true);
    }

    const monthly = firstValue(data, ["data.quota_monthly", "data.monthly"]);
    const monthlyLimit = firstNumber(monthly, ["max_flows", "totalFlow", "limit"]);
    const metrics = requireMetrics([
      flowWindow(data, "5h"),
      flowWindow(data, "7d"),
      monthlyLimit === undefined
        ? undefined
        : {
            key: "zenmux-monthly-cap",
            label: "月度 Flow 上限",
            kind: "instant" as const,
            unit: "flow",
            used: monthlyLimit,
            value: monthlyLimit,
          },
    ]);

    return {
      snapshot: snapshotPayloadSchema.parse({
        schemaVersion: 1,
        provider: "zenmux",
        capturedAt: context.now,
        identity: {},
        plan: firstString(data, ["data.plan.tier", "data.plan.name", "data.planName"]),
        metrics,
        source: { adapterVersion: "zenmux/2" },
      }),
    };
  },
};
