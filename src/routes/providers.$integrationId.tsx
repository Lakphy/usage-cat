import { ArrowLeft, ClockCounterClockwise } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ProviderMark } from "@/components/provider-mark";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { apiClient } from "@/lib/api";
import { toChartData } from "@/lib/chart-data";
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

function ProviderDetailPage() {
  const { locale, t } = useI18n();
  const { integrationId } = Route.useParams();
  const [range, setRange] = useState(ranges[1]);
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: apiClient.dashboard });
  const integration = dashboard.data?.data.find((item) => item.id === integrationId);
  const [selectedMetric, setSelectedMetric] = useState<string>();
  const metricKey = selectedMetric ?? integration?.metrics[0]?.key;
  const metric = integration?.metrics.find((item) => item.key === metricKey);
  const [delta, setDelta] = useState(false);
  const showRemaining = metric ? hasRemainingSemantics(metric) : false;
  const showDelta = delta && metric?.kind === "billing_counter" && !showRemaining;
  const to = Math.floor(Date.now() / 1000);
  const from = to - range.seconds;
  const history = useQuery({
    queryKey: ["history", integrationId, metricKey, range.seconds, showDelta],
    queryFn: () =>
      apiClient.history(
        integrationId,
        metricKey ?? "",
        from,
        to,
        showDelta ? "latest" : "envelope",
      ),
    enabled: Boolean(metricKey),
  });
  const snapshots = useQuery({
    queryKey: ["snapshots", integrationId],
    queryFn: () => apiClient.snapshots(integrationId, 20),
  });
  const chartData = useMemo(
    () => toChartData(history.data?.data ?? [], showDelta, locale),
    [history.data, showDelta, locale],
  );

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

      <div className="flex flex-wrap gap-2">
        {integration.metrics.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setSelectedMetric(item.key);
              setDelta(false);
            }}
            className={buttonVariants({
              variant: item.key === metricKey ? "default" : "outline",
              size: "sm",
            })}
          >
            {metricLabel(item, locale)} · {metricSummary(item, locale)}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {metric ? metricLabel(metric, locale) : t("Usage history", "用量历史")}
          </CardTitle>
          <CardDescription>
            {showRemaining
              ? t(
                  "The line shows remaining quota and breaks when a window resets.",
                  "折线展示剩余额度；窗口重置处会断开",
                )
              : t(
                  "Different units are shown separately and are not aggregated across providers.",
                  "不同单位分别展示，不进行跨平台合计",
                )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
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
            {metric?.kind === "billing_counter" && !showRemaining ? (
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
          {history.isLoading ? (
            <Skeleton className="h-80" />
          ) : history.isError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("History failed to load", "历史数据加载失败")}</AlertTitle>
              <AlertDescription>{localizedErrorMessage(history.error, locale)}</AlertDescription>
            </Alert>
          ) : chartData.length ? (
            <ChartContainer
              config={{
                value: {
                  label: metric ? metricLabel(metric, locale) : t("Usage", "用量"),
                  color: "var(--chart-3)",
                },
              }}
              className="h-80 w-full aspect-auto"
            >
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
                <YAxis tickLine={false} axisLine={false} width={45} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => payload[0]?.payload?.label ?? ""}
                    />
                  }
                />
                <Line
                  dataKey="value"
                  type="monotone"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Captured at", "采集时间")}</TableHead>
                <TableHead>{t("Metrics", "指标")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.data?.data.map((snapshot) => (
                <TableRow key={snapshot.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatTime(snapshot.capturedAt, locale)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {snapshot.payload?.metrics.map((item) => (
                        <Badge key={item.key} variant="outline">
                          {metricLabel(item, locale)} {metricSummary(item, locale)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {snapshots.isError ? (
                <TableRow>
                  <TableCell colSpan={2} className="h-24 text-center text-destructive">
                    {t("Snapshots failed to load: ", "快照加载失败：")}
                    {localizedErrorMessage(snapshots.error, locale)}
                  </TableCell>
                </TableRow>
              ) : !snapshots.data?.data.length ? (
                <TableRow>
                  <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                    {t("No snapshots", "暂无快照")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
