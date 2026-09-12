import { ChartLineUp, Database, Pulse } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PublicApiDocs } from "@/components/public-api-docs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { UsageCard } from "@/components/usage-card";
import { apiClient } from "@/lib/api";
import { localizedErrorMessage, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({ component: DashboardPage });

function DashboardPage() {
  const { locale, t } = useI18n();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: apiClient.dashboard,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="mb-3 text-[10px] tracking-[0.24em] text-muted-foreground">
            PERSONAL AI USAGE MONITOR
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("Every AI subscription, at a glance.", "所有 AI 订阅，一眼看清。")}
          </h1>
          <p className="mt-3 max-w-xl text-sm/6 text-muted-foreground">
            {t(
              "Every sync saves a new snapshot. Quotas, balances, and historical trends are public; access credentials are never exposed.",
              "每次同步都会保存一份新快照。这里公开展示额度、余额和历史趋势，不公开任何访问凭据。",
            )}
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-px border bg-border text-center lg:w-auto">
          <Stat
            icon={<Pulse />}
            value={query.data?.data.filter((item) => item.status === "healthy").length ?? 0}
            label={t("Healthy", "正常")}
          />
          <Stat
            icon={<Database />}
            value={query.data?.data.length ?? 0}
            label={t("Monitors", "监控项")}
          />
          <Stat icon={<ChartLineUp />} value="365d" label={t("History", "历史")} />
        </div>
      </section>

      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Dashboard failed to load", "看板载入失败")}</AlertTitle>
          <AlertDescription>{localizedErrorMessage(query.error, locale)}</AlertDescription>
        </Alert>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-3">
          {["first", "second", "third"].map((key) => (
            <Skeleton key={key} className="h-36" />
          ))}
        </div>
      ) : query.data?.data.length ? (
        <div className="space-y-3">
          {query.data.data.map((integration) => (
            <UsageCard key={integration.id} integration={integration} />
          ))}
        </div>
      ) : (
        <div className="grid min-h-72 place-items-center border border-dashed text-center">
          <div>
            <CatEmpty />
            <h2 className="mt-4 text-sm font-medium">{t("No monitors yet", "还没有监控项")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "An administrator can sign in to add the first AI subscription.",
                "管理员登录后即可添加第一个 AI 订阅。",
              )}
            </p>
          </div>
        </div>
      )}

      <PublicApiDocs />
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <div className="min-w-24 bg-background px-4 py-3">
      <div className="mx-auto mb-1 flex items-center justify-center gap-1 text-sm tabular-nums">
        {icon} {value}
      </div>
      <div className="whitespace-nowrap text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function CatEmpty() {
  return (
    <span className="mx-auto block size-12 border bg-[linear-gradient(135deg,transparent_48%,currentColor_49%,currentColor_51%,transparent_52%)] opacity-20" />
  );
}
