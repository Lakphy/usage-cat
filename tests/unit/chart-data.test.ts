import { describe, expect, it } from "vitest";
import { mergeChartSeries, metricChartColor, toChartData } from "@/lib/chart-data";
import { metricSummary } from "@/lib/format";
import type { HistoryPoint, UsageMetric } from "@/shared/usage";

function metric(overrides: Partial<UsageMetric>): UsageMetric {
  return { key: "test", label: "测试", kind: "quota_window", unit: "%", used: 0, ...overrides };
}

describe("折线图取数", () => {
  it("窗口真正回补时插入断点", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 80, percentage: 80, resetAt: 120 }) },
      { capturedAt: 130, metric: metric({ used: 5, percentage: 5, resetAt: 240 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([20, null, 95]);
  });

  it("resetAt 随采集时间滑动时不拆线", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 20, percentage: 20, resetAt: 18_100 }) },
      { capturedAt: 1_000, metric: metric({ used: 35, percentage: 35, resetAt: 19_000 }) },
      { capturedAt: 1_900, metric: metric({ used: 40, percentage: 40, resetAt: 19_900 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([80, 65, 60]);
  });

  it("resetAt 秒级抖动且额度未回补时不拆线", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 20, percentage: 20, resetAt: 50_000 }) },
      { capturedAt: 1_000, metric: metric({ used: 22, percentage: 22, resetAt: 50_001 }) },
      { capturedAt: 1_900, metric: metric({ used: 25, percentage: 25, resetAt: 50_000 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([80, 78, 75]);
  });

  it("未使用窗口按期翻过但剩余额度几乎不变时不拆线", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 0, percentage: 0, resetAt: 18_100 }) },
      { capturedAt: 18_200, metric: metric({ used: 0, percentage: 0, resetAt: 36_200 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([100, 100]);
  });

  it("resetAt 消失但剩余额度只是噪声回升时不拆线", () => {
    const points: HistoryPoint[] = [
      {
        capturedAt: 100,
        metric: metric({
          unit: "flow",
          used: 0.03,
          limit: 50,
          remaining: 49.97,
          percentage: 0.06,
          resetAt: 200,
        }),
      },
      {
        capturedAt: 300,
        metric: metric({ unit: "flow", used: 0, limit: 50, remaining: 50, percentage: 0 }),
      },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([49.97, 50]);
  });

  it("漏采后窗口已过且额度回补时仍断开", () => {
    const points: HistoryPoint[] = [
      { capturedAt: 100, metric: metric({ used: 90, percentage: 90, resetAt: 18_100 }) },
      { capturedAt: 19_000, metric: metric({ used: 5, percentage: 5, resetAt: 37_000 }) },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([10, null, 95]);
  });

  it("同一 periodStart 内剩余额度回升也不拆线", () => {
    const points: HistoryPoint[] = [
      {
        capturedAt: 100,
        metric: metric({ used: 40, percentage: 40, periodStart: 1, resetAt: 500 }),
      },
      {
        capturedAt: 200,
        metric: metric({ used: 10, percentage: 10, periodStart: 1, resetAt: 800 }),
      },
    ];
    expect(toChartData(points, false).map((point) => point.value)).toEqual([60, 90]);
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

  it("按时间对齐多条额度曲线并保留各自断点", () => {
    const merged = mergeChartSeries([
      {
        key: "weekly",
        points: [
          { time: 100, value: 80, label: "a" },
          { time: 129, value: null, label: "b" },
          { time: 130, value: 20, label: "b" },
        ],
      },
      {
        key: "monthly",
        points: [
          { time: 100, value: 400, label: "a" },
          { time: 160, value: 360, label: "c" },
        ],
      },
    ]);
    expect(merged).toEqual([
      { time: 100, label: "a", weekly: 80, monthly: 400 },
      { time: 129, label: "b", weekly: null, monthly: 400 - (40 * 29) / 60 },
      { time: 130, label: "b", weekly: 20, monthly: 380 },
      { time: 160, label: "c", monthly: 360 },
    ]);
  });

  it("额度颜色按稳定序号循环分配", () => {
    expect(metricChartColor(0)).toBe("var(--chart-1)");
    expect(metricChartColor(8)).toBe("var(--chart-1)");
    expect(metricChartColor(7)).toBe("var(--chart-8)");
  });
});
