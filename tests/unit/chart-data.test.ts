import { describe, expect, it } from "vitest";
import { toChartData } from "@/lib/chart-data";
import { metricSummary } from "@/lib/format";
import type { HistoryPoint, UsageMetric } from "@/shared/usage";

function metric(overrides: Partial<UsageMetric>): UsageMetric {
  return { key: "test", label: "测试", kind: "quota_window", unit: "%", used: 0, ...overrides };
}

describe("折线图取数", () => {
  it("窗口 resetAt 改变时插入断点", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 80, percentage: 80, resetAt: 120 }) },
      { capturedAt: 130, metric: metric({ used: 5, percentage: 5, resetAt: 240 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([20, null, 95]);
  });

  it("额度窗口优先绘制绝对剩余额度", () => {
    const points: HistoryPoint[] = [
      {
        capturedAt: 100,
        metric: metric({ unit: "flow", used: 0, limit: 50, remaining: 50, percentage: 0 }),
      },
    ];
    expect(toChartData(points, false)[0]?.value).toBe(50);
    expect(metricSummary(points[0].metric)).toBe("Remaining 50 / 50 flow");
    expect(metricSummary(points[0].metric, "zh-CN")).toBe("剩余 50 / 50 flow");
  });

  it("旧版 billing_counter 有有效上限时也按剩余额度绘制", () => {
    const points: HistoryPoint[] = [
      {
        capturedAt: 100,
        metric: metric({ kind: "billing_counter", unit: "credits", used: 30, limit: 100 }),
      },
    ];
    expect(toChartData(points, false)[0]?.value).toBe(70);
    expect(metricSummary(points[0].metric)).toBe("Remaining 70 / 100 credits");
  });

  it("计费增量只在同一账期内计算", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ kind: "billing_counter", used: 10, periodEnd: 200 }) },
      { capturedAt: 120, metric: metric({ kind: "billing_counter", used: 16, periodEnd: 200 }) },
      { capturedAt: 220, metric: metric({ kind: "billing_counter", used: 2, periodEnd: 300 }) },
    ];
    expect(toChartData(points, true).map((point) => point.value)).toEqual([null, 6, null]);
  });

  it("缺少账期标识时不跨点猜测增量", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ kind: "billing_counter", used: 10 }) },
      { capturedAt: 120, metric: metric({ kind: "billing_counter", used: 16 }) },
    ];
    expect(toChartData(points, true).map((point) => point.value)).toEqual([null, null]);
  });
});
