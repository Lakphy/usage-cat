import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUp,
  FloppyDisk,
  GithubLogo,
  Plus,
  SignOut,
  Trash,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CredentialGuide } from "@/components/credential-guide";
import { ProviderMark } from "@/components/provider-mark";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  type AdminIntegration,
  type AdminIntegrationsResponse,
  type AdminLimits,
  apiClient,
  type CreateIntegrationInput,
} from "@/lib/api";
import { formatTime, localizedPlan } from "@/lib/format";
import { localizedErrorMessage, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  integrationInputSchema,
  type KimiCredentialMode,
  type ProviderId,
  providerIds,
  providerMeta,
} from "@/shared/usage";

export const Route = createFileRoute("/admin")({ component: AdminPage });

function kimiCredentialModeOptions(t: (english: string, chinese: string) => string): Array<{
  value: KimiCredentialMode;
  label: string;
}> {
  return [
    {
      value: "code_cn",
      label: t(
        "Kimi Code subscription (China, kimi.com, sk-kimi-…)",
        "Kimi Code 会员（中国区 kimi.com，sk-kimi-…）",
      ),
    },
    {
      value: "code_global",
      label: t(
        "Kimi Code subscription (Global, kimi.ai, sk-kimi-…)",
        "Kimi Code 会员（海外区 kimi.ai，sk-kimi-…）",
      ),
    },
    {
      value: "platform_cn",
      label: t(
        "Platform balance (China, platform.kimi.com)",
        "开放平台余额（中国区 platform.kimi.com）",
      ),
    },
    {
      value: "platform_global",
      label: t(
        "API Platform balance (Global, platform.kimi.ai)",
        "API Platform 余额（海外区 platform.kimi.ai）",
      ),
    },
  ];
}

function AdminPage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["admin-session"],
    queryFn: apiClient.session,
    retry: false,
  });
  const integrations = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: apiClient.adminIntegrations,
    enabled: session.isSuccess,
  });
  const runs = useQuery({
    queryKey: ["sync-runs"],
    queryFn: apiClient.syncRuns,
    enabled: session.isSuccess,
    refetchInterval: 10_000,
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => apiClient.reorderIntegrations(orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ["admin-integrations"] });
      const previous = queryClient.getQueryData<AdminIntegrationsResponse>(["admin-integrations"]);
      if (previous) {
        const byId = new Map(previous.data.map((item) => [item.id, item]));
        queryClient.setQueryData<AdminIntegrationsResponse>(["admin-integrations"], {
          ...previous,
          data: orderedIds.flatMap((id, index) => {
            const item = byId.get(id);
            return item ? [{ ...item, sortOrder: (index + 1) * 100 }] : [];
          }),
        });
      }
      return { previous };
    },
    onError: (_error, _orderedIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["admin-integrations"], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const moveIntegration = (index: number, offset: -1 | 1) => {
    const items = integrations.data?.data;
    const target = index + offset;
    if (!items || target < 0 || target >= items.length || reorder.isPending) return;
    const orderedIds = items.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    reorder.mutate(orderedIds);
  };
  const refreshAdmin = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-integrations"] });
    void queryClient.invalidateQueries({ queryKey: ["sync-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  if (session.isLoading) return <Skeleton className="h-[36rem]" />;
  if (session.isError) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <GithubLogo className="mx-auto size-10" />
        <h1 className="mt-5 text-xl font-semibold">
          {t("Administrator access required", "需要管理员身份")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Public data remains available. Configuration requires a GitHub account on the administrator allowlist.",
            "公开数据仍可直接查看，管理配置需通过 GitHub 白名单登录。",
          )}
        </p>
        <Link to="/login" className={cn(buttonVariants(), "mt-6")}>
          {t("Go to sign-in", "前往登录")}
        </Link>
      </div>
    );
  }
  const admin = session.data?.data;
  if (!admin) return <Skeleton className="h-[36rem]" />;

  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-muted-foreground">ADMIN CONSOLE</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("Usage collection settings", "用量采集配置")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Up to", "最多启用")} {integrations.data?.limits.enabled ?? 10}{" "}
            {t(
              "monitors can be enabled; the combined scheduled-sync limit is",
              "个监控项；所有项目合计最多计划同步",
            )}{" "}
            {integrations.data?.limits.scheduledSyncsPerDay ?? "…"} {t("per day.", "次/天。")}
          </p>
        </div>
        <div className="flex w-fit items-center gap-3 bg-muted/60 px-3 py-2 text-xs">
          {admin.githubAvatarUrl ? (
            <img src={admin.githubAvatarUrl} alt="" className="size-8" />
          ) : null}
          <span className="font-medium">@{admin.githubLogin}</span>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-1"
            onClick={async () => {
              await apiClient.logout();
              window.location.href = "/";
            }}
          >
            <SignOut data-icon="inline-start" />
            {t("Sign out", "退出")}
          </Button>
        </div>
      </section>

      <CreateIntegrationCard limits={integrations.data?.limits} onCreated={refreshAdmin} />

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium">{t("Monitors", "监控项")}</h2>
          <span className="text-[11px] text-muted-foreground">
            {t("Enabled", "已启用")}{" "}
            {integrations.data?.data.filter((item) => item.enabled).length ?? 0} /{" "}
            {integrations.data?.limits.enabled ?? 10} · {t("Scheduled", "计划")}{" "}
            {integrations.data?.limits.scheduledSyncsPerDayUsed ?? 0} /{" "}
            {integrations.data?.limits.scheduledSyncsPerDay ?? "…"} {t("per day", "次/天")}
          </span>
        </div>
        {integrations.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Failed to load", "读取失败")}</AlertTitle>
            <AlertDescription>{localizedErrorMessage(integrations.error, locale)}</AlertDescription>
          </Alert>
        ) : null}
        {reorder.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Ordering failed", "排序失败")}</AlertTitle>
            <AlertDescription>{localizedErrorMessage(reorder.error, locale)}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3">
          {integrations.data?.data.map((integration, index, items) => (
            <AdminIntegrationCard
              key={integration.id}
              integration={integration}
              limits={integrations.data?.limits}
              onChanged={refreshAdmin}
              position={index}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              reordering={reorder.isPending}
              onMove={(offset) => moveIntegration(index, offset)}
            />
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("Recent syncs", "最近同步")}</CardTitle>
          <CardDescription>
            {t(
              "Failure diagnostics are retained; credentials are never echoed in the UI or logs.",
              "保留失败诊断；界面和日志都不会回显访问凭据。",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="min-w-[42rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t("Monitor", "监控项")}</TableHead>
                <TableHead>{t("Trigger", "触发")}</TableHead>
                <TableHead>{t("Status", "状态")}</TableHead>
                <TableHead>{t("Time", "时间")}</TableHead>
                <TableHead>{t("Diagnostic", "诊断")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data?.data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="pl-4 font-medium">{run.display_name}</TableCell>
                  <TableCell>
                    {run.trigger_type === "schedule"
                      ? t("Scheduled", "定时")
                      : run.trigger_type === "manual"
                        ? t("Manual", "手动")
                        : t("Verification", "验证")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatTime(run.scheduled_at, locale)}
                  </TableCell>
                  <TableCell
                    className="max-w-48 truncate text-muted-foreground"
                    title={
                      run.error_code
                        ? localizedErrorMessage(
                            { code: run.error_code, message: run.error_message },
                            locale,
                          )
                        : undefined
                    }
                  >
                    {run.error_code ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!runs.data?.data.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    {t("No sync runs yet", "暂无同步记录")}
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

function dailySyncs(intervalMinutes: number): number | undefined {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) return undefined;
  return 1440 / intervalMinutes;
}

function formatDailySyncs(value: number, locale: "en" | "zh-CN"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function credentialLabel(
  provider: ProviderId,
  t: (english: string, chinese: string) => string,
): string {
  if (provider === "zenmux") {
    return t("Management API Key (sk-mg-v1-…)", "Management API Key（sk-mg-v1-…）");
  }
  return providerMeta[provider].credentialLabel;
}

function CreateIntegrationCard({
  limits,
  onCreated,
}: {
  limits?: AdminLimits;
  onCreated: () => void;
}) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string>();
  const form = useForm<CreateIntegrationInput>({
    resolver: zodResolver(integrationInputSchema),
    defaultValues: {
      provider: "codex",
      displayName: "",
      intervalMinutes: providerMeta.codex.defaultIntervalMinutes,
      enabled: true,
      credential: "",
      credentialMode: "code_cn",
    },
  });
  const provider = form.watch("provider");
  const kimiCredentialMode = form.watch("credentialMode") ?? "code_cn";
  const intervalMinutes = form.watch("intervalMinutes");
  const enabled = form.watch("enabled");
  const integrationDailySyncs = enabled ? dailySyncs(intervalMinutes) : 0;
  const proposedDailySyncs =
    integrationDailySyncs === undefined || limits === undefined
      ? undefined
      : limits.scheduledSyncsPerDayUsed + integrationDailySyncs;
  const mutation = useMutation({
    mutationFn: apiClient.createIntegration,
    onSuccess: () => {
      form.reset();
      setSelectedFileName(undefined);
      setExpanded(false);
      setSubmitted(true);
      onCreated();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Add AI provider", "添加 AI 平台")}</CardTitle>
        <CardDescription>
          {t(
            "Select a provider to see credential sources, exact paths, and troubleshooting tips. Credentials are encrypted with AES-256-GCM.",
            "选择平台后会显示凭据来源、完整路径和排错提示；凭据会以 AES-256-GCM 加密保存。",
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant={expanded ? "secondary" : "default"}
            size="sm"
            onClick={() => setExpanded((value) => !value)}
          >
            <Plus data-icon="inline-start" />
            {t("Add", "新增")}
          </Button>
        </CardAction>
      </CardHeader>
      {submitted ? (
        <CardContent>
          <Alert>
            <AlertTitle>{t("Submitted", "已提交")}</AlertTitle>
            <AlertDescription>
              {t(
                "Monitor created. Credential verification has been queued.",
                "监控项已创建，凭据验证已进入队列。",
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      ) : null}
      {expanded ? (
        <CardContent>
          <form
            className="grid gap-x-6 gap-y-5 lg:grid-cols-2"
            onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
          >
            <Field
              label={t("Provider", "平台")}
              description={t(
                "The credential instructions below update for the selected provider.",
                "选择后，下方“如何取得凭据”会切换成对应平台的步骤。",
              )}
              error={form.formState.errors.provider?.message}
            >
              <select
                className="h-8 w-full border bg-background px-2.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/50"
                value={provider}
                onChange={(event) => {
                  form.setValue("provider", event.target.value as ProviderId, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  form.setValue(
                    "intervalMinutes",
                    providerMeta[event.target.value as ProviderId].defaultIntervalMinutes,
                    { shouldDirty: true, shouldValidate: true },
                  );
                  form.setValue("credential", "", { shouldDirty: false });
                  setSelectedFileName(undefined);
                }}
              >
                {providerIds.map((id) => (
                  <option key={id} value={id}>
                    {providerMeta[id].name}
                    {providerMeta[id].beta ? " (Beta)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("Display name", "显示名称")}
              description={t(
                "Used only on the public dashboard; it does not need to match the provider account name.",
                "只作为公开看板上的名称，不需要和平台账号名一致。",
              )}
              error={form.formState.errors.displayName?.message}
            >
              <Input
                placeholder={t("For example: My Codex", "例如：我的 Codex")}
                {...form.register("displayName")}
              />
            </Field>
            <Field
              label={t("Refresh interval (minutes)", "刷新周期（分钟）")}
              description={
                integrationDailySyncs === undefined
                  ? t(
                      "Every successful sync appends a snapshot. Minimum: 5 minutes.",
                      "每次成功同步追加一条历史快照；最短 5 分钟。",
                    )
                  : locale === "en"
                    ? `About ${formatDailySyncs(integrationDailySyncs, locale)} syncs/day for this monitor${
                        proposedDailySyncs === undefined
                          ? ""
                          : `; about ${formatDailySyncs(proposedDailySyncs, locale)} / ${limits?.scheduledSyncsPerDay ?? "…"} syncs/day total when enabled`
                      }. Recommended for ${providerMeta[provider].name}: ${providerMeta[provider].defaultIntervalMinutes} minutes.`
                    : `本项约 ${formatDailySyncs(integrationDailySyncs, locale)} 次/天${
                        proposedDailySyncs === undefined
                          ? ""
                          : `；启用后全部约 ${formatDailySyncs(proposedDailySyncs, locale)} / ${limits?.scheduledSyncsPerDay ?? "…"} 次/天`
                      }。${providerMeta[provider].name} 建议 ${providerMeta[provider].defaultIntervalMinutes} 分钟。`
              }
              error={form.formState.errors.intervalMinutes?.message}
            >
              <Input
                type="number"
                min={5}
                max={1440}
                {...form.register("intervalMinutes", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label={t("Enable after creation", "创建后启用")}
              description={t(
                "When off, the configuration is saved without scheduled syncs.",
                "关闭时只保存配置，不执行定时同步。",
              )}
            >
              <div className="flex h-8 items-center justify-between bg-muted/60 px-3">
                <span className="text-xs">
                  {enabled
                    ? t("Scheduled sync enabled", "启用定时同步")
                    : t("Keep disabled", "暂不启用")}
                </span>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    form.setValue("enabled", checked, { shouldDirty: true })
                  }
                />
              </div>
            </Field>
            <div className="space-y-3 lg:col-span-2">
              {provider === "kimi" ? (
                <Field
                  label={t("Product and region", "产品与区域")}
                  description={t(
                    "This must match the site that issued the key. The key is never sent to another region for probing.",
                    "必须和 Key 的创建网站一致；系统不会把 Key 发往其他区域试探。",
                  )}
                  error={form.formState.errors.credentialMode?.message}
                >
                  <select
                    className="h-8 w-full border bg-background px-2.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/50"
                    {...form.register("credentialMode")}
                  >
                    {kimiCredentialModeOptions(t).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <CredentialGuide provider={provider} kimiMode={kimiCredentialMode} />
              <Field
                label={credentialLabel(provider, t)}
                error={form.formState.errors.credential?.message}
              >
                {providerMeta[provider].credentialKind === "auth-file" ? (
                  <div className="space-y-1.5">
                    <Input
                      type="file"
                      accept="application/json,.json"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          form.setValue("credential", await file.text(), {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          setSelectedFileName(file.name);
                        }
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {selectedFileName
                        ? t(
                            `Read ${selectedFileName}; only the required parsed fields will be submitted.`,
                            `已读取 ${selectedFileName}；只会提交解析后的必要字段。`,
                          )
                        : t(
                            "Choose the auth.json file described above.",
                            "请选择上方说明中的 auth.json 文件。",
                          )}
                    </p>
                  </div>
                ) : (
                  <Textarea
                    rows={3}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      provider === "cursor"
                        ? "crsr_…"
                        : provider === "zenmux"
                          ? "sk-mg-v1-…"
                          : kimiCredentialMode.startsWith("code_")
                            ? "sk-kimi-…"
                            : t("Platform sk-… key", "开放平台 sk-… Key")
                    }
                    {...form.register("credential")}
                  />
                )}
              </Field>
            </div>
            {mutation.isError ? (
              <Alert variant="destructive" className="lg:col-span-2">
                <AlertTitle>{t("Creation failed", "创建失败")}</AlertTitle>
                <AlertDescription>{localizedErrorMessage(mutation.error, locale)}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end lg:col-span-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? t("Saving…", "正在保存…")
                  : t("Save and verify", "保存并验证")}
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Field({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {description ? (
        <p className="text-[10px] leading-4 text-muted-foreground">{description}</p>
      ) : null}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

function AdminIntegrationCard({
  integration,
  limits,
  onChanged,
  position,
  canMoveUp,
  canMoveDown,
  reordering,
  onMove,
}: {
  integration: AdminIntegration;
  limits?: AdminLimits;
  onChanged: () => void;
  position: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reordering: boolean;
  onMove: (offset: -1 | 1) => void;
}) {
  const { locale, t } = useI18n();
  const [interval, setInterval] = useState(integration.intervalMinutes);
  const [replacement, setReplacement] = useState("");
  const [replacementFileName, setReplacementFileName] = useState<string>();
  const [showCredential, setShowCredential] = useState(false);
  const [kimiCredentialMode, setKimiCredentialMode] = useState<KimiCredentialMode>("code_cn");
  const mutation = useMutation({
    mutationFn: (body: Partial<Omit<CreateIntegrationInput, "provider">>) =>
      apiClient.updateIntegration(integration.id, body),
    onSuccess: onChanged,
  });
  const action = useMutation({
    mutationFn: async (kind: "sync" | "archive") => {
      if (kind === "archive") return apiClient.archiveIntegration(integration.id);
      return apiClient.syncIntegration(integration.id);
    },
    onSuccess: onChanged,
  });
  const provider = providerMeta[integration.provider];
  const error = mutation.error ?? action.error;
  const proposedContribution = integration.enabled ? dailySyncs(interval) : 0;
  const currentContribution = integration.enabled ? 1440 / integration.intervalMinutes : 0;
  const proposedDailySyncs =
    proposedContribution === undefined || limits === undefined
      ? undefined
      : Math.max(0, limits.scheduledSyncsPerDayUsed - currentContribution + proposedContribution);
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <ProviderMark provider={integration.provider} />
          <div className="min-w-0">
            <CardTitle className="truncate">{integration.displayName}</CardTitle>
            <CardDescription className="truncate">
              {integration.publicIdentity ?? t("Identity pending", "身份待识别")}
              {integration.plan ? ` · ${localizedPlan(integration.plan, locale)}` : ""}
            </CardDescription>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <fieldset className="mr-1 flex min-w-0 items-center border bg-background">
            <legend className="sr-only">{t("Display order", "展示顺序")}</legend>
            <span className="min-w-7 px-1.5 text-center text-[10px] text-muted-foreground tabular-nums">
              #{position + 1}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("Move up", "上移")}
              title={t("Move up", "上移")}
              disabled={!canMoveUp || reordering}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("Move down", "下移")}
              title={t("Move down", "下移")}
              disabled={!canMoveDown || reordering}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
          </fieldset>
          {provider.beta ? <Badge variant="outline">Beta</Badge> : null}
          <StatusBadge status={integration.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1fr)_minmax(14rem,0.9fr)_auto] xl:items-start">
          <Field
            label={t("Interval (minutes)", "周期（分钟）")}
            description={
              proposedContribution === undefined
                ? t("Minimum: 5 minutes.", "最短 5 分钟。")
                : locale === "en"
                  ? `About ${formatDailySyncs(proposedContribution, locale)} syncs/day for this monitor${
                      proposedDailySyncs === undefined
                        ? ""
                        : `; about ${formatDailySyncs(proposedDailySyncs, locale)} / ${limits?.scheduledSyncsPerDay ?? "…"} syncs/day total after saving`
                    }.`
                  : `本项约 ${formatDailySyncs(proposedContribution, locale)} 次/天${
                      proposedDailySyncs === undefined
                        ? ""
                        : `；保存后全部约 ${formatDailySyncs(proposedDailySyncs, locale)} / ${limits?.scheduledSyncsPerDay ?? "…"} 次/天`
                    }。`
            }
          >
            <div className="flex gap-2">
              <Input
                type="number"
                min={5}
                max={1440}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
              <Button
                variant="outline"
                disabled={mutation.isPending || interval === integration.intervalMinutes}
                onClick={() => mutation.mutate({ intervalMinutes: interval })}
              >
                <FloppyDisk data-icon="inline-start" />
                {t("Save", "保存")}
              </Button>
            </div>
          </Field>
          <Field
            label={t("Scheduled sync", "定时同步")}
            description={
              integration.enabled
                ? t(
                    `Next sync: ${formatTime(integration.nextSyncAt, locale)}`,
                    `下次同步：${formatTime(integration.nextSyncAt, locale)}`,
                  )
                : t(
                    "Currently paused; no scheduled syncs will run.",
                    "当前已暂停，不会执行定时同步。",
                  )
            }
          >
            <div className="flex h-8 items-center justify-between bg-muted/60 px-3">
              <span className="text-xs">
                {integration.enabled ? t("Enabled", "已启用") : t("Paused", "已暂停")}
              </span>
              <Switch
                checked={integration.enabled}
                disabled={mutation.isPending}
                onCheckedChange={(enabled) => mutation.mutate({ enabled })}
              />
            </div>
          </Field>
          <Field
            label={t("Actions", "操作")}
            description={t(
              "Sync, replace the credential, or archive this monitor.",
              "同步、换凭据或归档此监控项。",
            )}
          >
            <div className="flex h-8 items-center gap-2">
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate("sync")}
              >
                <ArrowClockwise data-icon="inline-start" />
                {t("Sync now", "立即同步")}
              </Button>
              <Button
                variant={showCredential ? "secondary" : "outline"}
                onClick={() => setShowCredential((value) => !value)}
              >
                {t("Replace credential", "替换凭据")}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                aria-label={t("Archive monitor", "归档监控项")}
                disabled={action.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      t(
                        "Archiving immediately deletes the credential. Historical snapshots remain for 365 days. Continue?",
                        "归档后凭据会立即删除，历史快照仍保留 365 天。继续吗？",
                      ),
                    )
                  )
                    action.mutate("archive");
                }}
              >
                <Trash />
              </Button>
            </div>
          </Field>
        </div>
        {showCredential ? (
          <div className="space-y-3 bg-muted/40 p-4">
            <div>
              <p className="text-xs font-medium">
                {t("Replace access credential", "替换访问凭据")}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t(
                  "The new credential is verified after saving and is never echoed in the UI or logs.",
                  "保存后会先验证新凭据；输入内容不会在页面或日志中回显。",
                )}
              </p>
            </div>
            {integration.provider === "kimi" ? (
              <Field label={t("Product and region", "产品与区域")}>
                <select
                  className="h-8 w-full border bg-background px-2.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/50"
                  value={kimiCredentialMode}
                  onChange={(event) =>
                    setKimiCredentialMode(event.target.value as KimiCredentialMode)
                  }
                >
                  {kimiCredentialModeOptions(t).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <CredentialGuide
              provider={integration.provider}
              kimiMode={kimiCredentialMode}
              compact
            />
            {provider.credentialKind === "auth-file" ? (
              <div className="space-y-1.5">
                <Input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setReplacement(await file.text());
                      setReplacementFileName(file.name);
                    }
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {replacementFileName
                    ? t(`Read ${replacementFileName}`, `已读取 ${replacementFileName}`)
                    : t(
                        "Choose the auth.json file described above.",
                        "请选择上方说明中的 auth.json 文件。",
                      )}
                </p>
              </div>
            ) : (
              <Textarea
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                rows={2}
                autoComplete="off"
                spellCheck={false}
                placeholder={credentialLabel(integration.provider, t)}
              />
            )}
            <Button
              variant="secondary"
              disabled={!replacement || mutation.isPending}
              onClick={() => {
                mutation.mutate(
                  {
                    credential: replacement,
                    ...(integration.provider === "kimi"
                      ? { credentialMode: kimiCredentialMode }
                      : {}),
                  },
                  {
                    onSuccess: () => {
                      setReplacement("");
                      setReplacementFileName(undefined);
                      setShowCredential(false);
                    },
                  },
                );
              }}
            >
              {t("Save and verify", "保存并验证")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Operation failed", "操作失败")}</AlertTitle>
            <AlertDescription>{localizedErrorMessage(error, locale)}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
