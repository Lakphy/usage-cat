import { ArrowRight, ClockCounterClockwise } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { ProviderMark } from "@/components/provider-mark";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  formatTime,
  hasRemainingSemantics,
  localizedPlan,
  metricLabel,
  metricSummary,
  quotaRemainingPercentage,
  relativeTime,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { PublicIntegration, UsageMetric } from "@/shared/usage";

function MetricRow({ metric }: { metric: UsageMetric }) {
  const { locale, t } = useI18n();
  const remainingPercentage = quotaRemainingPercentage(metric);
  const showRemaining = hasRemainingSemantics(metric);
  const progressValue = showRemaining ? remainingPercentage : metric.percentage;
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0 font-medium text-foreground">{metricLabel(metric, locale)}</span>
        <span className="shrink-0 text-right font-medium tabular-nums">
          {metricSummary(metric, locale)}
        </span>
      </div>
      {progressValue !== undefined ? (
        <Progress
          value={Math.min(100, progressValue)}
          aria-label={
            showRemaining
              ? t("Remaining quota percentage", "剩余额度比例")
              : t("Used quota percentage", "已用额度比例")
          }
        />
      ) : null}
      {(showRemaining && remainingPercentage !== undefined) || metric.resetAt ? (
        <div className="flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
          {showRemaining && remainingPercentage !== undefined ? (
            <p>
              {t("Remaining", "剩余")} {remainingPercentage.toFixed(1).replace(/\.0$/, "")}%
              {metric.percentage !== undefined
                ? ` · ${t("Used", "已用")} ${metric.percentage.toFixed(1).replace(/\.0$/, "")}%`
                : ""}
            </p>
          ) : null}
          {metric.resetAt ? (
            <p className="ml-auto shrink-0 text-right">
              {formatTime(metric.resetAt, locale)} {t("reset", "重置")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function UsageCard({ integration }: { integration: PublicIntegration }) {
  const { locale, t } = useI18n();
  return (
    <Card className="py-5 transition-shadow hover:shadow-sm">
      <div className="grid gap-5 px-4 sm:px-5 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,2fr)_auto] lg:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ProviderMark provider={integration.provider} />
            {integration.plan ? (
              <span className="text-[10px] text-muted-foreground">
                {localizedPlan(integration.plan, locale)}
              </span>
            ) : null}
          </div>
          <div>
            <h2 className="break-words text-sm font-medium">{integration.displayName}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {integration.publicIdentity ?? t("Identity pending", "身份待识别")}
            </p>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          {integration.metrics.length ? (
            integration.metrics
              .slice(0, 3)
              .map((metric) => <MetricRow key={metric.key} metric={metric} />)
          ) : (
            <div className="grid min-h-16 place-items-center bg-muted/40 text-muted-foreground">
              {t("Waiting for the first snapshot", "等待首次快照")}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 lg:min-w-36 lg:flex-col lg:items-end">
          <div className="flex flex-wrap items-center gap-1 lg:justify-end">
            {!integration.enabled ? <Badge variant="outline">{t("Paused", "已暂停")}</Badge> : null}
            <StatusBadge status={integration.status} />
          </div>
          <div className="text-right">
            <p
              className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground"
              title={formatTime(integration.lastSyncedAt, locale)}
            >
              <ClockCounterClockwise /> {relativeTime(integration.lastSyncedAt, locale)}
            </p>
          </div>
          <Link
            to="/providers/$integrationId"
            params={{ integrationId: integration.id }}
            className="inline-flex items-center gap-1 text-xs font-medium hover:text-muted-foreground"
          >
            {t("View history", "查看历史")}
            <ArrowRight />
          </Link>
        </div>
      </div>
    </Card>
  );
}
