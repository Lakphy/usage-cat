import { ArrowLeft, ClockCounterClockwise } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ProviderMark } from "@/components/provider-mark";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api";
import { mergeChartSeries, metricChartColor, toChartData } from "@/lib/chart-data";
import {
  formatTime,
  hasRemainingSemantics,
  localizedPlan,
  metricLabel,
  metricSummary,
  relativeTime,
} from "@/lib/format";
import { localizedErrorMessage, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { UsageMetric } from "@/shared/usage";
import { providerMeta } from "@/shared/usage";

export const Route = createFileRoute("/providers/$integrationId")({
  component: ProviderDetailPage,
});

const ranges = [
  { en: "24 hours", zh: "24 小时", seconds: 86_400 },
  { en: "7 days", zh: "7 天", seconds: 7 * 86_400 },
  { en: "30 days", zh: "30 天", seconds: 30 * 86_400 },
  { en: "90 days", zh: "90 天", seconds: 90 * 86_400 },
  { en: "1 year", zh: "1 年", seconds: 365 * 86_400 },
];

function supportsIncrement(metric: UsageMetric) {
  return metric.kind === "billing_counter" && !hasRemainingSemantics(metric);
}

function ProviderDetailPage() {
  const { locale, t } = useI18n();
  const { integrationId } = Route.useParams();
  const [range, setRange] = useState(ranges[1]);
  const [delta, setDelta] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: apiClient.dashboard });
  const integration = dashboard.data?.data.find((item) => item.id === integrationId);
  const metrics = integration?.metrics ?? [];
  const visibleKeys = selectedKeys
    ? selectedKeys.filter((key) => metrics.some((metric) => metric.key === key))
    : metrics.map((metric) => metric.key);
  const visibleMetrics = metrics.filter((metric) => visibleKeys.includes(metric.key));
  const incrementMode =
    delta && visibleMetrics.length > 0 && visibleMetrics.every(supportsIncrement);
  const to = Math.floor(Date.now() / 1000);
  const from = to - range.seconds;
  const histories = useQueries({
    queries: metrics.map((metric) => {
      const useDelta = incrementMode && supportsIncrement(metric);
      return {
        queryKey: ["history", integrationId, metric.key, range.seconds, useDelta],
        queryFn: () =>
          apiClient.history(integrationId, metric.key, from, to, useDelta ? "latest" : "envelope"),
      };
    }),
  });
  const snapshots = useQuery({
    queryKey: ["snapshots", integrationId],
    queryFn: () => apiClient.snapshots(integrationId, 20),
  });
  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        metrics.map((metric, index) => [
          metric.key,
          { label: metricLabel(metric, locale), color: metricChartColor(index) },
        ]),
      ),
    [metrics, locale],
  );
  const visibleHistories = visibleMetrics.map(
    (metric) => histories[metrics.findIndex((item) => item.key === metric.key)],
  );
  const chartData = useMemo(
    () =>
      mergeChartSeries(
        visibleMetrics.map((metric, index) => ({
          key: metric.key,
          points: toChartData(
            visibleHistories[index]?.data?.data ?? [],
            incrementMode && supportsIncrement(metric),
            locale,
          ),
        })),
      ),
    [visibleMetrics, visibleHistories, incrementMode, locale],
  );
  const historyPending = visibleHistories.some((item) => item?.isPending);
  const historyError = visibleHistories.find((item) => item?.isError);

  if (dashboard.isLoading) return <Skeleton className="h-[32rem]" />;
  if (dashboard.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("Dashboard failed to load", "看板加载失败")}</AlertTitle>
        <AlertDescription>{localizedErrorMessage(dashboard.error, locale)}</AlertDescription>
      </Alert>
    );
  }
  if (!integration) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("Monitor not found", "找不到监控项")}</AlertTitle>
        <AlertDescription>{t("It may have been archived.", "它可能已被归档。")}</AlertDescription>
      </Alert>
    );
  }

  function toggleMetric(key: string) {
    setSelectedKeys((current) => {
      const base = current ?? metrics.map((metric) => metric.key);
      return base.includes(key) ? base.filter((item) => item !== key) : [...base, key];
    });
  }

  return (
    <div className="space-y-6">
      <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2")}>
        <ArrowLeft data-icon="inline-start" /> {t("Back to dashboard", "返回看板")}
      </Link>
      <section className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
          <ProviderMark provider={integration.provider} className="h-9 px-3 text-xs" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-semibold tracking-tight">
                {integration.displayName}
              </h1>
              <StatusBadge status={integration.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {providerMeta[integration.provider].name} ·{" "}
              {integration.publicIdentity ?? t("Identity pending", "身份待识别")} ·{" "}
              {localizedPlan(integration.plan, locale) ?? t("Plan pending", "套餐待识别")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ClockCounterClockwise />
          {t(
            `Last synced ${relativeTime(integration.lastSyncedAt, locale)}`,
            `上次同步：${relativeTime(integration.lastSyncedAt, locale)}`,
          )}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("Usage history", "用量历史")}</CardTitle>
          <CardDescription>
            {t(
              "All selected quotas share one chart. Colors distinguish each type; remaining-quota series only break when a window actually refills.",
              "所选额度叠加在同一张折线图中，颜色区分类型。剩余额度只在窗口真正回补时断开。",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              {ranges.map((item) => (
                <button
                  key={item.seconds}
                  type="button"
                  onClick={() => setRange(item)}
                  className={buttonVariants({
                    variant: item.seconds === range.seconds ? "secondary" : "ghost",
                    size: "xs",
                  })}
                >
                  {t(item.en, item.zh)}
                </button>
              ))}
            </div>
            {visibleMetrics.length > 0 && visibleMetrics.every(supportsIncrement) ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  className={buttonVariants({ variant: !delta ? "outline" : "ghost", size: "xs" })}
                  onClick={() => setDelta(false)}
                >
                  {t("Cumulative", "累计")}
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: delta ? "outline" : "ghost", size: "xs" })}
                  onClick={() => setDelta(true)}
                >
                  {t("Increment", "新增")}
                </button>
              </div>
            ) : null}
          </div>
          {metrics.length ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {metrics.map((item, index) => {
                const selected = visibleKeys.includes(item.key);
                const color = metricChartColor(index);
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleMetric(item.key)}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      !selected && "opacity-45",
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {metricLabel(item, locale)} · {metricSummary(item, locale)}
                  </button>
                );
              })}
            </div>
          ) : null}
          {!visibleKeys.length ? (
            <div className="grid h-80 place-items-center border border-dashed text-xs text-muted-foreground">
              {t("Select at least one quota to plot", "请至少选择一项额度")}
            </div>
          ) : historyPending ? (
            <Skeleton className="h-80" />
          ) : historyError?.error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("History failed to load", "历史数据加载失败")}</AlertTitle>
              <AlertDescription>
                {localizedErrorMessage(historyError.error, locale)}
              </AlertDescription>
            </Alert>
          ) : chartData.length ? (
            <ChartContainer config={chartConfig} className="h-80 w-full aspect-auto">
              <LineChart data={chartData} margin={{ left: 8, right: 8, top: 12 }}>
                <CartesianGrid vertical={false} />
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
                <YAxis tickLine={false} axisLine={false} width={52} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => payload[0]?.payload?.label ?? ""}
                    />
                  }
                />
                {visibleMetrics.map((metric) => (
                  <Line
                    key={metric.key}
                    dataKey={metric.key}
                    name={metric.key}
                    type="monotone"
                    stroke={`var(--color-${metric.key})`}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="grid h-80 place-items-center border border-dashed text-xs text-muted-foreground">
              {t("No snapshots in this time range", "这个时间范围内还没有快照")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Recent snapshots", "最近快照")}</CardTitle>
          <CardDescription>
            {t(
              "Every successful sync adds a row; equal values never overwrite old snapshots.",
              "每次成功同步都会新增一行，数值相同也不会覆盖旧记录。",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.length > 1 ? (
            <Tabs defaultValue={metrics[0]?.key}>
              <TabsList variant="line" className="mb-4 h-auto flex-wrap justify-start">
                {metrics.map((metric, index) => (
                  <TabsTrigger key={metric.key} value={metric.key}>
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: metricChartColor(index) }}
                    />
                    {metricLabel(metric, locale)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {metrics.map((metric) => (
                <TabsContent key={metric.key} value={metric.key}>
                  <SnapshotTable
                    metricKey={metric.key}
                    snapshots={snapshots.data?.data}
                    isError={snapshots.isError}
                    error={snapshots.error}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <SnapshotTable
              metricKey={metrics[0]?.key}
              snapshots={snapshots.data?.data}
              isError={snapshots.isError}
              error={snapshots.error}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SnapshotTable({
  metricKey,
  snapshots,
  isError,
  error,
}: {
  metricKey?: string;
  snapshots?: Array<{
    id: string;
    capturedAt: number;
    payload?: { metrics: UsageMetric[] } | null;
  }>;
  isError: boolean;
  error: unknown;
}) {
  const { locale, t } = useI18n();
  const rows = (snapshots ?? []).flatMap((snapshot) => {
    const metric = metricKey
      ? snapshot.payload?.metrics.find((item) => item.key === metricKey)
      : snapshot.payload?.metrics[0];
    return metric ? [{ snapshot, metric }] : [];
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Captured at", "采集时间")}</TableHead>
          <TableHead>{t("Value", "数值")}</TableHead>
          <TableHead>{t("Reset", "重置")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ snapshot, metric }) => (
          <TableRow key={snapshot.id}>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatTime(snapshot.capturedAt, locale)}
            </TableCell>
            <TableCell>{metricSummary(metric, locale)}</TableCell>
            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
              {metric.resetAt ? formatTime(metric.resetAt, locale) : "—"}
            </TableCell>
          </TableRow>
        ))}
        {isError ? (
          <TableRow>
            <TableCell colSpan={3} className="h-24 text-center text-destructive">
              {t("Snapshots failed to load: ", "快照加载失败：")}
              {localizedErrorMessage(error, locale)}
            </TableCell>
          </TableRow>
        ) : !rows.length ? (
          <TableRow>
            <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
              {t("No snapshots", "暂无快照")}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
