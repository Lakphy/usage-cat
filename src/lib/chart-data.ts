import { formatTime, hasRemainingSemantics, quotaRemaining } from "@/lib/format";
import type { Locale } from "@/shared/locale";
import type { HistoryPoint, UsageMetric } from "@/shared/usage";

export interface ChartPoint {
  time: number;
  value: number | null;
  label: string;
}

export function chartValue(metric: UsageMetric): number | undefined {
  if (metric.kind === "balance") return metric.value ?? metric.used;
  if (hasRemainingSemantics(metric)) return quotaRemaining(metric);
  return metric.percentage ?? metric.used ?? metric.value;
}

export function toChartData(
  points: HistoryPoint[],
  delta: boolean,
  locale: Locale = "en",
): ChartPoint[] {
  const rows: ChartPoint[] = [];
  let previous: HistoryPoint | undefined;
  for (const point of points) {
    const currentValue = chartValue(point.metric);
    if (currentValue === undefined) continue;
    const periodChanged =
      previous &&
      hasRemainingSemantics(point.metric) &&
      previous.metric.resetAt !== undefined &&
      point.metric.resetAt !== previous.metric.resetAt;
    if (periodChanged) {
      rows.push({
        time: point.capturedAt - 1,
        value: null,
        label: formatTime(point.capturedAt, locale),
      });
    }
    let value: number | null = currentValue;
    if (delta) {
      const previousValue = previous ? chartValue(previous.metric) : undefined;
      const currentPeriod =
        point.metric.periodStart ?? point.metric.periodEnd ?? point.metric.resetAt;
      const previousPeriod = previous
        ? (previous.metric.periodStart ?? previous.metric.periodEnd ?? previous.metric.resetAt)
        : undefined;
      const samePeriod =
        previous &&
        currentPeriod !== undefined &&
        previousPeriod !== undefined &&
        currentPeriod === previousPeriod;
      value =
        samePeriod && previousValue !== undefined
          ? Math.max(0, currentValue - previousValue)
          : null;
    }
    rows.push({ time: point.capturedAt, value, label: formatTime(point.capturedAt, locale) });
    previous = point;
  }
  return rows;
}
