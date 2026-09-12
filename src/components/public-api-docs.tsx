import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";

const DASHBOARD_PATH = "/api/v1/public/dashboard";

const EXAMPLE_RESPONSE = `{
  "data": [
    {
      "id": "8f2c1a6e-4b91-4d0e-9c3a-1e7b5d2f0a44",
      "provider": "kimi",
      "displayName": "Kimi",
      "publicIdentity": "user@example.com",
      "plan": "Kimi Code",
      "status": "healthy",
      "enabled": true,
      "intervalMinutes": 15,
      "lastSyncedAt": 1700000000,
      "metrics": [
        {
          "key": "kimi-weekly",
          "label": "每周额度",
          "kind": "quota_window",
          "unit": "credits",
          "used": 20,
          "limit": 100,
          "remaining": 80,
          "percentage": 20,
          "resetAt": 1700604800
        }
      ]
    }
  ],
  "generatedAt": 1700000000
}`;

function usePageOrigin() {
  const [origin, setOrigin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  return origin;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function CodeBlock({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 border bg-muted/40 px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto text-[11px] leading-5 whitespace-pre">
        <code>{value}</code>
      </pre>
      <CopyButton value={value} label={t(`Copy ${label}`, `复制 ${label}`)} />
    </div>
  );
}

export function PublicApiDocs() {
  const { t } = useI18n();
  const origin = usePageOrigin();
  const dashboardUrl = `${origin}${DASHBOARD_PATH}`;
  const curl = `curl -sS ${dashboardUrl}`;
  const javascript = `const response = await fetch("${dashboardUrl}");
const { data, generatedAt } = await response.json();`;

  const fields = [
    [
      "data",
      "Monitor[]",
      t("Unarchived monitors, sorted by display order.", "未归档监控项，按展示顺序。"),
    ],
    ["data[].id", "string", t("Monitor UUID.", "监控项 UUID。")],
    [
      "data[].provider",
      "string",
      t("codex, cursor, grok, zenmux, or kimi.", "codex / cursor / grok / zenmux / kimi。"),
    ],
    ["data[].displayName", "string", t("Public display name.", "公开显示名。")],
    [
      "data[].publicIdentity",
      "string?",
      t("Email or username from the latest snapshot.", "最新快照中的邮箱或用户名。"),
    ],
    ["data[].plan", "string?", t("Upstream plan name, if known.", "上游套餐名（若已识别）。")],
    [
      "data[].status",
      "string",
      t("pending, healthy, or action_required.", "pending / healthy / action_required。"),
    ],
    ["data[].enabled", "boolean", t("Whether scheduled sync is enabled.", "是否仍按周期同步。")],
    [
      "data[].intervalMinutes",
      "number",
      t("Scheduled sync interval, 5–1440.", "计划同步间隔，5–1440 分钟。"),
    ],
    [
      "data[].lastSyncedAt",
      "number?",
      t("Last successful sync, Unix seconds.", "最近一次成功同步，Unix 秒。"),
    ],
    [
      "data[].metrics",
      "Metric[]",
      t(
        "Latest snapshot metrics. Empty before the first success.",
        "最新快照指标；尚未成功同步时为空。",
      ),
    ],
    ["generatedAt", "number", t("Response time, Unix seconds.", "响应生成时间，Unix 秒。")],
  ] as const;

  return (
    <section id="public-api" className="space-y-5 border-t pt-10">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)] md:items-end">
        <div>
          <p className="mb-3 text-[10px] tracking-[0.24em] text-muted-foreground">PUBLIC API</p>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("Same JSON the dashboard uses.", "和看板同一份 JSON。")}
          </h2>
          <p className="mt-3 max-w-xl text-sm/6 text-muted-foreground">
            {t(
              "No login, API key, or cookie. Any client can read this instance's public monitors. Credentials are never included.",
              "无需登录、API Key 或 Cookie。任何客户端都可以读取这个实例的公开监控项，响应里不会出现访问凭据。",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 md:justify-end">
          <Badge variant="outline">{t("No auth", "无需鉴权")}</Badge>
          <Badge variant="outline">GET</Badge>
          <Badge variant="outline">CORS *</Badge>
          <Badge variant="outline">{t("Unix seconds", "Unix 秒")}</Badge>
        </div>
      </div>

      <div className="space-y-3 border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            <span className="text-muted-foreground">GET</span> {DASHBOARD_PATH}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Cache-Control: public, max-age=30, s-maxage=60
          </p>
        </div>
        <CodeBlock value={dashboardUrl || DASHBOARD_PATH} label={t("URL", "地址")} />
        <Tabs defaultValue="curl">
          <TabsList variant="line">
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="javascript">JavaScript</TabsTrigger>
          </TabsList>
          <TabsContent value="curl" className="mt-3">
            <CodeBlock value={curl} label="curl" />
          </TabsContent>
          <TabsContent value="javascript" className="mt-3">
            <CodeBlock value={javascript} label="JavaScript" />
          </TabsContent>
        </Tabs>
      </div>

      <div className="overflow-hidden border">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-medium">{t("Response fields", "响应字段")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Field", "字段")}</th>
                <th className="px-4 py-2 font-medium">{t("Type", "类型")}</th>
                <th className="px-4 py-2 font-medium">{t("Description", "说明")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([field, type, description]) => (
                <tr key={field} className="border-b last:border-b-0">
                  <td className="px-4 py-2 align-top whitespace-nowrap">
                    <code>{field}</code>
                  </td>
                  <td className="px-4 py-2 align-top whitespace-nowrap text-muted-foreground">
                    {type}
                  </td>
                  <td className="px-4 py-2 align-top text-muted-foreground">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-[11px] leading-5 text-muted-foreground">
          {t(
            "Each metric includes key, label, kind (quota_window, billing_counter, balance, instant), unit, and optional used, limit, remaining, value, percentage, resetAt, periodStart, and periodEnd.",
            "每条 metric 含 key、label、kind（quota_window / billing_counter / balance / instant）、unit，以及可选的 used、limit、remaining、value、percentage、resetAt、periodStart、periodEnd。",
          )}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("Example response", "响应示例")}</h3>
        <CodeBlock value={EXAMPLE_RESPONSE} label={t("example", "示例")} />
      </div>

      <div className="space-y-3 border p-4 sm:p-5">
        <h3 className="text-sm font-medium">{t("Related public endpoints", "相关公开接口")}</h3>
        <p className="text-xs/6 text-muted-foreground">
          {t(
            "History charts and snapshot tables use these next. Archived monitors return 404 from history.",
            "详情页的折线和快照表用下面两个接口。归档监控项的 history 会返回 404。",
          )}
        </p>
        <div className="space-y-2 text-[11px] leading-5">
          <p>
            <span className="text-muted-foreground">GET</span>{" "}
            <code>
              /api/v1/public/integrations/:id/history?metric=&amp;from=&amp;to=&amp;sampling=
            </code>
          </p>
          <p>
            <span className="text-muted-foreground">GET</span>{" "}
            <code>/api/v1/public/integrations/:id/snapshots?limit=&amp;cursor=</code>
          </p>
        </div>
      </div>
    </section>
  );
}
