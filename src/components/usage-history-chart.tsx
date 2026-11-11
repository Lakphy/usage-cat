import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  type ChartScale,
  chartAxisId,
  chartNumberUnit,
  chartScale,
  formatChartTick,
  formatChartTooltipValue,
  type MultiSeriesChartPoint,
  usesDualChartAxis,
} from "@/lib/chart-data";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { UsageMetric } from "@/shared/usage";

export function UsageHistoryChart({
  data,
  metrics,
  config,
}: {
  data: MultiSeriesChartPoint[];
  metrics: UsageMetric[];
  config: ChartConfig;
}) {
  const { locale, t } = useI18n();
  const dual = usesDualChartAxis(metrics);
  const percentOnly =
    metrics.length > 0 && metrics.every((metric) => chartScale(metric) === "percent");
  const numberUnit = chartNumberUnit(metrics);
  const sharedScale: ChartScale = percentOnly ? "percent" : "number";

  function formatTooltipValue(value: unknown, name: string | number | undefined) {
    const numeric = typeof value === "number" ? value : Number(value);
    const metric = metrics.find((item) => item.key === name);
    if (!metric || !Number.isFinite(numeric)) return String(value);
    return formatChartTooltipValue(numeric, chartScale(metric), locale);
  }

  return (
    <div>
      {dual ? (
        <div className="mb-1 flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
          <span>{t("Percent", "百分比")}</span>
          <span className="min-w-0 truncate text-right">{numberUnit ?? t("Amount", "数值")}</span>
        </div>
      ) : null}
      <ChartContainer config={config} className="aspect-auto h-80 w-full">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
          <CartesianGrid vertical={false} yAxisId={dual ? "percent" : "shared"} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            minTickGap={42}
            tickFormatter={(value) => formatTime(Number(value), locale)}
          />
          {dual ? (
            <>
              <HistoryYAxis id="percent" scale="percent" />
              <HistoryYAxis id="number" scale="number" orientation="right" />
            </>
          ) : (
            <HistoryYAxis id="shared" scale={sharedScale} />
          )}
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload[0]?.payload?.label ?? ""}
                valueFormatter={formatTooltipValue}
              />
            }
          />
          {metrics.map((metric) => (
            <Line
              key={metric.key}
              yAxisId={chartAxisId(metric, dual)}
              dataKey={metric.key}
              name={metric.key}
              type="linear"
              stroke={`var(--color-${metric.key})`}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function HistoryYAxis({
  id,
  scale,
  orientation = "left",
}: {
  id: "shared" | ChartScale;
  scale: ChartScale;
  orientation?: "left" | "right";
}) {
  const { locale } = useI18n();
  const percent = scale === "percent";
  return (
    <YAxis
      yAxisId={id}
      orientation={orientation}
      tickLine={false}
      axisLine={false}
      width={percent ? 48 : 64}
      tickMargin={4}
      tickFormatter={(value) => formatChartTick(Number(value), scale, locale)}
      {...(percent
        ? {
            allowDecimals: false as const,
            domain: [0, 100] as const,
            padding: { top: 8, bottom: 0 },
          }
        : {})}
    />
  );
}
