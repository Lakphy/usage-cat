import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "healthy" || status === "succeeded") {
    return <Badge variant="outline">{t("Healthy", "正常")}</Badge>;
  }
  if (status === "pending" || status === "queued" || status === "running") {
    return (
      <Badge variant="secondary">
        {status === "running" ? t("Syncing", "同步中") : t("Pending", "等待中")}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      {status === "failed" ? t("Failed", "失败") : t("Action required", "需要处理")}
    </Badge>
  );
}
