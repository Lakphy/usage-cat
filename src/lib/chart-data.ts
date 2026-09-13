import { formatTime, hasRemainingSemantics, quotaRemaining } from "@/lib/format";
import type { Locale } from "@/shared/locale";
import type { HistoryPoint, UsageMetric } from "@/shared/usage";

export interface ChartPoint {
  time: number;
  value: number | null;
  label: string;
}

export type MultiSeriesChartPoint = {
  time: number;
  label: string;
} & Record<string, number | string | null>;

export const CHART_COLOR_COUNT = 8;

export function metricChartColor(index: number): string {
  return `var(--chart-${(index % CHART_COLOR_COUNT) + 1})`;
}

function interpolatedValue(points: ChartPoint[], time: number): number | undefined {
  let previous: ChartPoint | undefined;
  let next: ChartPoint | undefined;
  for (const point of points) {
    if (point.value === null) continue;
    if (point.time <= time) previous = point;
    if (point.time >= time && next === undefined) next = point;
  }
  if (previous?.value == null || next?.value == null) return undefined;
  if (previous.time === next.time) return previous.value;
  const ratio = (time - previous.time) / (next.time - previous.time);
  return previous.value + (next.value - previous.value) * ratio;
}

export function mergeChartSeries(
  series: Array<{ key: string; points: ChartPoint[] }>,
): MultiSeriesChartPoint[] {
  const times = new Set<number>();
  const prepared = series.map(({ key, points }) => {
    const values = new Map<number, { value: number | null; label: string }>();
    for (const point of points) {
      times.add(point.time);
      values.set(point.time, { value: point.value, label: point.label });
    }
    return { key, points, values };
  });
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const row: MultiSeriesChartPoint = { time, label: "" };
      for (const item of prepared) {
        const point = item.values.get(time);
        if (point) {
          row[item.key] = point.value;
          if (!row.label) row.label = point.label;
          continue;
        }
        const value = interpolatedValue(item.points, time);
        if (value !== undefined) row[item.key] = value;
      }
      return row;
    });
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
