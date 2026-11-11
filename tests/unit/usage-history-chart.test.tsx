import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChartConfig } from "@/components/ui/chart";
import { UsageHistoryChart } from "@/components/usage-history-chart";
import { I18nProvider } from "@/lib/i18n";
import type { UsageMetric } from "@/shared/usage";

function metric(overrides: Partial<UsageMetric>): UsageMetric {
  return { key: "test", label: "测试", kind: "quota_window", unit: "%", used: 0, ...overrides };
}

const percent = metric({
  key: "codex-primary",
  label: "7 天窗口",
  unit: "%",
  used: 88,
  limit: 100,
  remaining: 12,
  percentage: 88,
});
const credits = metric({
  key: "codex-credits",
  label: "Credits 余额",
  kind: "balance",
  unit: "credits",
  used: 62_500,
  value: 62_500,
});

const config: ChartConfig = {
  "codex-primary": { label: "7-day window", color: "var(--chart-1)" },
  "codex-credits": { label: "Credits balance", color: "var(--chart-2)" },
};

function renderChart(metrics: UsageMetric[]) {
  return render(
    <I18nProvider initialLocale="en">
      <UsageHistoryChart
        metrics={metrics}
        config={config}
        data={[
          { time: 100, label: "a", "codex-primary": 92, "codex-credits": 0 },
          { time: 200, label: "b", "codex-primary": 12, "codex-credits": 62_500 },
        ]}
      />
    </I18nProvider>,
  );
}

function yAxisTicks(container: HTMLElement): string[][] {
  return [...container.querySelectorAll(".recharts-yAxis-tick-labels")].map((group) =>
    [...group.querySelectorAll("text")].map((node) => node.textContent ?? ""),
  );
}

describe("用量历史双纵轴", () => {
  afterEach(() => {
    cleanup();
  });

  it("百分比固定在 0–100，绝对数值单独使用右侧纵轴", () => {
    const { container, getByText } = renderChart([percent, credits]);
    const axes = yAxisTicks(container);
    const percentAxis = axes.find((ticks) => ticks.includes("100%"));
    const numberAxis = axes.find((ticks) => ticks.includes("80k"));

    expect(getByText("Percent")).toBeInTheDocument();
    expect(getByText("credits")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-yAxis")).toHaveLength(2);
    expect(percentAxis).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(numberAxis).toEqual(["0", "20k", "40k", "60k", "80k"]);
    const xOf = (label: string) =>
      Number(
        [...container.querySelectorAll("text")]
          .find((node) => node.textContent === label)
          ?.getAttribute("x"),
      );
    expect(xOf("100%")).toBeLessThan(xOf("80k"));
  });

  it("只有百分比时保持单轴", () => {
    const { container, queryByText } = renderChart([percent]);
    const axes = yAxisTicks(container);

    expect(queryByText("Percent")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-yAxis")).toHaveLength(1);
    expect(axes).toEqual([["0%", "25%", "50%", "75%", "100%"]]);
  });

  it("中文把大额数字刻度写成万", () => {
    const { container, getByText } = render(
      <I18nProvider initialLocale="zh-CN">
        <UsageHistoryChart
          metrics={[percent, credits]}
          config={config}
          data={[
            { time: 100, label: "a", "codex-primary": 92, "codex-credits": 0 },
            { time: 200, label: "b", "codex-primary": 12, "codex-credits": 62_500 },
          ]}
        />
      </I18nProvider>,
    );

    expect(getByText("百分比")).toBeInTheDocument();
    expect(yAxisTicks(container).flat()).toEqual(
      expect.arrayContaining(["100%", "0", "2万", "4万", "6万", "8万"]),
    );
  });

  it("只有绝对数值时不锁到百分比刻度", () => {
    const { container, queryByText } = renderChart([credits]);
    const axes = yAxisTicks(container);

    expect(queryByText("Percent")).not.toBeInTheDocument();
    expect(queryByText("credits")).not.toBeInTheDocument();
    expect(axes).toEqual([["0", "20k", "40k", "60k", "80k"]]);
  });
});
