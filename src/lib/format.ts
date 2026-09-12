import { format as formatDate, formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { Locale } from "@/shared/locale";
import type { UsageMetric } from "@/shared/usage";

function dateLocale(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}

export function formatTime(epoch?: number, locale: Locale = "en"): string {
  if (!epoch) return locale === "zh-CN" ? "暂无" : "No data";
  return formatDate(new Date(epoch * 1000), "MM-dd HH:mm", { locale: dateLocale(locale) });
}

export function relativeTime(epoch?: number, locale: Locale = "en"): string {
  if (!epoch) return locale === "zh-CN" ? "尚未同步" : "Not synced yet";
  return formatDistanceToNow(new Date(epoch * 1000), {
    locale: dateLocale(locale),
    addSuffix: true,
  });
}

function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function hasRemainingSemantics(metric: UsageMetric): boolean {
  return (
    metric.kind === "quota_window" ||
    (metric.limit !== undefined &&
      metric.limit > 0 &&
      (metric.remaining !== undefined || metric.used !== undefined))
  );
}

export function quotaRemaining(metric: UsageMetric): number | undefined {
  if (!hasRemainingSemantics(metric)) return undefined;
  if (metric.remaining !== undefined) return metric.remaining;
  if (metric.limit !== undefined && metric.used !== undefined) {
    return Math.max(0, metric.limit - metric.used);
  }
  if (metric.percentage !== undefined) return Math.max(0, 100 - metric.percentage);
  return undefined;
}

export function quotaRemainingPercentage(metric: UsageMetric): number | undefined {
  if (!hasRemainingSemantics(metric)) return undefined;
  const remaining = quotaRemaining(metric);
  if (remaining !== undefined && metric.limit !== undefined && metric.limit > 0) {
    return Math.min(100, Math.max(0, (remaining / metric.limit) * 100));
  }
  return metric.percentage === undefined
    ? undefined
    : Math.min(100, Math.max(0, 100 - metric.percentage));
}

export function metricValue(metric: UsageMetric, locale: Locale = "en"): string {
  const value = metric.kind === "balance" ? (metric.value ?? metric.used) : metric.used;
  if (value === undefined) return "—";
  if (metric.unit === "%") return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  if (metric.unit === "USD cents") return `$${(value / 100).toFixed(2)}`;
  return `${formatNumber(value, locale)} ${metric.unit}`;
}

export function metricSummary(metric: UsageMetric, locale: Locale = "en"): string {
  if (hasRemainingSemantics(metric)) {
    const remaining = quotaRemaining(metric);
    if (remaining !== undefined) {
      const prefix = locale === "zh-CN" ? "剩余" : "Remaining";
      if (metric.unit === "%") return `${prefix} ${formatNumber(remaining, locale)}%`;
      if (metric.limit !== undefined) {
        return `${prefix} ${formatNumber(remaining, locale)} / ${formatNumber(metric.limit, locale)} ${metric.unit}`;
      }
      return `${prefix} ${formatNumber(remaining, locale)} ${metric.unit}`;
    }
  }
  if (metric.percentage !== undefined)
    return `${metric.percentage.toFixed(1).replace(/\.0$/, "")}%`;
  return metricValue(metric, locale);
}

const englishMetricLabels: Record<string, string> = {
  "codex-credits": "Credits balance",
  "codex-spend-control": "Workspace quota",
  "cursor-api-usage": "API model usage",
  "cursor-auto-usage": "Auto model usage",
  "cursor-grok-bot-weekly": "Grok Bot weekly quota",
  "cursor-models": "Cursor Models",
  "cursor-other-models": "Other Models",
  "cursor-plan-usage": "Included billing-cycle quota",
  "cursor-plan-usage-percent": "Included billing-cycle quota",
  "cursor-usage-based": "On-Demand usage",
  "grok-included-credits": "Included credits quota",
  "grok-included-legacy": "Included credits quota (compatibility)",
  "grok-on-demand": "On-Demand usage",
  "grok-prepaid-balance": "Prepaid credits balance",
  "kimi-booster-balance": "Booster balance",
  "kimi-booster-monthly": "Booster monthly usage",
  "kimi-platform-available-balance": "Available balance",
  "kimi-platform-cash-balance": "Cash balance",
  "kimi-platform-voucher-balance": "Voucher balance",
  "kimi-weekly": "Weekly quota",
  "zenmux-5h": "5-hour Flow quota",
  "zenmux-7d": "7-day Flow quota",
  "zenmux-monthly-cap": "Monthly Flow cap",
};

export function metricLabel(metric: UsageMetric, locale: Locale = "en"): string {
  if (locale === "zh-CN") return metric.label;
  const known = englishMetricLabels[metric.key];
  if (known) {
    if (metric.key === "cursor-auto-usage" && metric.limit !== undefined) return "Auto model quota";
    if (metric.key === "cursor-api-usage" && metric.limit !== undefined) return "API model quota";
    if (metric.key === "cursor-usage-based" && metric.limit !== undefined) return "On-Demand quota";
    if (metric.key === "grok-on-demand" && metric.limit !== undefined) return "On-Demand quota";
    if (metric.key === "kimi-booster-monthly" && metric.limit !== undefined)
      return "Booster monthly quota";
    return known;
  }

  return metric.label
    .replace(/(\d+) 小时窗口/g, "$1-hour window")
    .replace(/(\d+) 天窗口/g, "$1-day window")
    .replace(/(\d+) 分钟额度/g, "$1-minute quota")
    .replace(/(\d+) 小时额度/g, "$1-hour quota")
    .replace(/(\d+) 天额度/g, "$1-day quota")
    .replace(/(\d+) 周额度/g, "$1-week quota")
    .replace(/主窗口/g, "Primary window")
    .replace(/次窗口/g, "Secondary window")
    .replace(/额度窗口 (\d+)/g, "Quota window $1");
}

export function localizedPlan(plan: string | undefined, locale: Locale): string | undefined {
  if (!plan || locale === "zh-CN") return plan;
  const plans: Record<string, string> = {
    "Kimi Code（中国区）": "Kimi Code (China)",
    "Kimi Code（海外区）": "Kimi Code (Global)",
    "Kimi 开放平台（中国区）": "Kimi Platform (China)",
    "Kimi API Platform（海外区）": "Kimi API Platform (Global)",
  };
  return plans[plan] ?? plan;
}
