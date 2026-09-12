import { ArrowSquareOut, Info, ShieldCheck } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import type { KimiCredentialMode, ProviderId } from "@/shared/usage";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-foreground"
    >
      {children}
      <ArrowSquareOut className="size-3" aria-hidden="true" />
    </a>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="bg-muted px-1 py-0.5 text-[0.92em] text-foreground">{children}</code>;
}

function Command({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <code className="block overflow-x-auto border bg-background px-2 py-1.5 text-[10px] leading-5 text-foreground">
        {children}
      </code>
    </div>
  );
}

function FilePickerTip() {
  const { locale } = useI18n();
  return (
    <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
      {locale === "en" ? (
        <>
          If dot-prefixed folders are hidden: press <InlineCode>⌘⇧G</InlineCode> in the macOS file
          picker; paste the path into the Windows address bar; or press{" "}
          <InlineCode>Ctrl+L</InlineCode> to paste a path or <InlineCode>Ctrl+H</InlineCode> to show
          hidden files on Linux.
        </>
      ) : (
        <>
          看不到以点开头的目录时：macOS 文件选择器按 <InlineCode>⌘⇧G</InlineCode>，Windows
          在地址栏粘贴路径，Linux 按 <InlineCode>Ctrl+L</InlineCode> 粘贴路径或按{" "}
          <InlineCode>Ctrl+H</InlineCode> 显示隐藏文件。
        </>
      )}
    </p>
  );
}

function SecretNotice() {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex gap-2 border-t pt-3 text-[10px] leading-5 text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden="true" />
      <p>
        {t(
          "Treat credentials like passwords. Submit them only in this admin console—never in chats, tickets, or repositories. The server extracts only fields needed for syncing and stores them encrypted.",
          "凭据等同于密码。只在这个管理后台提交，不要发到聊天、工单或代码仓库；服务器只提取同步所需字段并加密保存。",
        )}
      </p>
    </div>
  );
}

function GuideShell({
  title,
  summary,
  children,
  compact = false,
}: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="border bg-muted/25 p-3" aria-label={title}>
      <div className="flex gap-2">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-medium">{title}</p>
          <div className="mt-1 text-[10px] leading-5 text-muted-foreground">{summary}</div>
        </div>
      </div>
      <div className={compact ? "mt-2" : "mt-3"}>{children}</div>
    </section>
  );
}

function AuthFileGuide({ provider, compact }: { provider: "codex" | "grok"; compact?: boolean }) {
  const { locale, t } = useI18n();
  const codex = provider === "codex";
  const product = codex ? "Codex" : "Grok";
  const isolatedDirectory = codex ? ".usage-cat-codex" : ".usage-cat-grok";
  const defaultDirectory = codex ? ".codex" : ".grok";
  const homeVariable = codex ? "CODEX_HOME" : "GROK_HOME";
  const loginCommand = codex ? "codex login" : "grok login";
  const docsUrl = codex
    ? "https://developers.openai.com/codex/auth"
    : "https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md";

  return (
    <GuideShell
      title={t(`How to get ${product} auth.json`, `如何取得 ${product} auth.json`)}
      compact={compact}
      summary={
        locale === "en" ? (
          <>
            Upload <InlineCode>auth.json</InlineCode>, not <InlineCode>os.json</InlineCode>. We
            recommend a separate usage-cat login so cloud token refreshes do not affect your daily{" "}
            {product} session.{" "}
            <ExternalLink href={docsUrl}>Open official authentication docs</ExternalLink>
          </>
        ) : (
          <>
            要上传的文件名是 <InlineCode>auth.json</InlineCode>，不是{" "}
            <InlineCode>os.json</InlineCode>。 推荐为 usage-cat
            单独登录，避免云端刷新令牌影响你日常使用的 {product} 会话。{" "}
            <ExternalLink href={docsUrl}>查看官方认证说明</ExternalLink>
          </>
        )
      }
    >
      <ol className="list-decimal space-y-2 pl-5 text-[10px] leading-5">
        <li>
          {t(
            "Open a terminal, run the isolated login command for your system, then complete sign-in in the browser:",
            "打开终端，执行与你系统对应的隔离登录命令，然后在浏览器完成登录：",
          )}
          <Command label="macOS / Linux">
            mkdir -p ~/{isolatedDirectory} &amp;&amp; {homeVariable}="$HOME/{isolatedDirectory}"{" "}
            {loginCommand}
          </Command>
          <Command label="Windows PowerShell">
            $env:{homeVariable}="$HOME\{isolatedDirectory}"; {loginCommand}
          </Command>
          <p className="mt-1 text-muted-foreground">
            {codex
              ? t(
                  'Choose "Sign in with ChatGPT". An OpenAI Platform API key cannot read Codex subscription quotas.',
                  "登录方式请选择“使用 ChatGPT 登录”；OpenAI 开放平台 API Key 不能读取 Codex 会员额度。",
                )
              : t(
                  "Sign in with the Grok subscription account. A model API key from console.x.ai cannot replace this file.",
                  "需要使用 Grok 订阅账号完成浏览器登录；console.x.ai 创建的模型 API Key 不能替代此文件。",
                )}
          </p>
        </li>
        <li>
          {t(
            "After sign-in succeeds, choose the generated file below:",
            "登录成功后，在下方选择生成的文件：",
          )}
          <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <span>macOS / Linux</span>
            <InlineCode>~/{isolatedDirectory}/auth.json</InlineCode>
            <span>Windows</span>
            <InlineCode>%USERPROFILE%\{isolatedDirectory}\auth.json</InlineCode>
          </div>
        </li>
      </ol>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        {locale === "en" ? (
          <>
            To use an existing login cache, the default path is{" "}
            <InlineCode>~/{defaultDirectory}/auth.json</InlineCode> on macOS/Linux or{" "}
            <InlineCode>%USERPROFILE%\{defaultDirectory}\auth.json</InlineCode> on Windows. If the
            default Codex path does not exist, the login is usually stored in the system keychain;
            the isolated command above creates an uploadable file.
          </>
        ) : (
          <>
            如果你明确要使用现有登录缓存，默认路径是 macOS / Linux 的{" "}
            <InlineCode>~/{defaultDirectory}/auth.json</InlineCode>，或 Windows 的{" "}
            <InlineCode>%USERPROFILE%\{defaultDirectory}\auth.json</InlineCode>。若 Codex
            默认路径不存在，通常是登录信息在系统钥匙串中；运行上面的隔离登录命令即可生成可上传文件。
          </>
        )}
      </p>
      <FilePickerTip />
      <SecretNotice />
    </GuideShell>
  );
}

function CursorGuide({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  return (
    <GuideShell
      title={t("How to get a Cursor User API Key", "如何取得 Cursor User API Key")}
      compact={compact}
      summary={
        locale === "en" ? (
          <>
            Use a personal <InlineCode>crsr_…</InlineCode> User API Key; no local file is needed.{" "}
            <ExternalLink href="https://cursor.com/dashboard">Open Cursor Dashboard</ExternalLink>
          </>
        ) : (
          <>
            这里需要个人账号的 <InlineCode>crsr_…</InlineCode> User API Key，不需要找本地文件。{" "}
            <ExternalLink href="https://cursor.com/dashboard">打开 Cursor Dashboard</ExternalLink>
          </>
        )
      }
    >
      <ol className="list-decimal space-y-1 pl-5 text-[10px] leading-5">
        <li>
          {t(
            "Sign in to Cursor Dashboard and open Integrations.",
            "登录 Cursor Dashboard，进入 Integrations。",
          )}
        </li>
        <li>
          {t("Find User API Keys and create a new key.", "找到 User API Keys，选择创建新的 Key。")}
        </li>
        <li>
          {locale === "en" ? (
            <>
              Immediately copy the full value beginning with <InlineCode>crsr_</InlineCode> and
              paste it below.
            </>
          ) : (
            <>
              立即复制以 <InlineCode>crsr_</InlineCode> 开头的完整内容，粘贴到下方输入框。
            </>
          )}
        </li>
      </ol>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        {locale === "en" ? (
          <>
            Do not use a team Admin API Key (usually <InlineCode>key_</InlineCode>) or a model
            provider key configured under Cursor Models, such as OpenAI or Anthropic.
          </>
        ) : (
          <>
            不要填写团队 Admin API Key（通常以 <InlineCode>key_</InlineCode>
            开头），也不要填写在 Cursor「Models」中配置的 OpenAI、Anthropic 等模型厂商 Key。
          </>
        )}
      </p>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        {t(
          "Collected metrics match the Spending page: Cursor Models, Other Models, and the Grok Bot weekly quota. When On-Demand is disabled, no misleading zero-value On-Demand metric is shown.",
          "采集结果对应 Spending 页的 Cursor Models、Other Models 与 Grok Bot 周额度；未启用 On-Demand 时不会显示一条虚假的 0 元按量付费额度。",
        )}
      </p>
      <SecretNotice />
    </GuideShell>
  );
}

function ZenMuxGuide({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  return (
    <GuideShell
      title={t("How to get a ZenMux Management API Key", "如何取得 ZenMux Management API Key")}
      compact={compact}
      summary={
        locale === "en" ? (
          <>
            The subscription quota endpoint only accepts a personal{" "}
            <InlineCode>sk-mg-v1-…</InlineCode> management key.{" "}
            <ExternalLink href="https://zenmux.ai/platform/management">
              Open ZenMux Management
            </ExternalLink>
          </>
        ) : (
          <>
            订阅额度接口只接受个人账号的 <InlineCode>sk-mg-v1-…</InlineCode> 管理 Key。{" "}
            <ExternalLink href="https://zenmux.ai/platform/management">
              打开 ZenMux Management
            </ExternalLink>
          </>
        )
      }
    >
      <ol className="list-decimal space-y-1 pl-5 text-[10px] leading-5">
        <li>
          {t(
            "Sign in to ZenMux and confirm that the avatar menu shows your personal account.",
            "登录 ZenMux，并确认头像菜单中当前是你的个人账号。",
          )}
        </li>
        <li>
          {t(
            "Open Management and create a Management API Key.",
            "进入 Management 页面，创建 Management API Key。",
          )}
        </li>
        <li>
          {locale === "en" ? (
            <>
              Copy the key beginning with <InlineCode>sk-mg-v1-</InlineCode> and paste it below.
            </>
          ) : (
            <>
              复制以 <InlineCode>sk-mg-v1-</InlineCode> 开头的 Key，粘贴到下方。
            </>
          )}
        </li>
      </ol>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        {locale === "en" ? (
          <>
            <InlineCode>sk-ss-v1-…</InlineCode> is a subscription inference key and{" "}
            <InlineCode>sk-ai-v1-…</InlineCode> is a PAYG inference key. Neither can query account
            subscription quotas.
          </>
        ) : (
          <>
            <InlineCode>sk-ss-v1-…</InlineCode> 是订阅模型调用 Key，
            <InlineCode>sk-ai-v1-…</InlineCode> 是 PAYG 模型调用 Key；它们都不能查询账户订阅额度。
          </>
        )}
      </p>
      <SecretNotice />
    </GuideShell>
  );
}

const kimiGuides: Record<
  KimiCredentialMode,
  {
    title: { en: string; zh: string };
    consoleUrl: string;
    consoleName: { en: string; zh: string };
    expectedKey: { en: string; zh: string };
    endpoint: string;
    purpose: { en: string; zh: string };
  }
> = {
  code_cn: {
    title: { en: "Kimi Code subscription (China)", zh: "Kimi Code 会员订阅（中国区）" },
    consoleUrl: "https://www.kimi.com/code/console",
    consoleName: { en: "Kimi Code China console", zh: "Kimi Code 中国区控制台" },
    expectedKey: { en: "sk-kimi-…", zh: "sk-kimi-…" },
    endpoint: "api.kimi.com",
    purpose: {
      en: "collecting weekly, 5-hour, and Booster remaining subscription quotas",
      zh: "采集会员每周、5 小时窗口和 Booster 剩余额度",
    },
  },
  code_global: {
    title: { en: "Kimi Code subscription (Global)", zh: "Kimi Code 会员订阅（海外区）" },
    consoleUrl: "https://www.kimi.ai/code/console",
    consoleName: { en: "Kimi Code Global console", zh: "Kimi Code 海外区控制台" },
    expectedKey: { en: "sk-kimi-…", zh: "sk-kimi-…" },
    endpoint: "api.kimi.ai",
    purpose: {
      en: "collecting Global subscription windows and remaining Booster quota",
      zh: "采集海外会员的额度窗口和 Booster 剩余额度",
    },
  },
  platform_cn: {
    title: { en: "Kimi Platform balance (China)", zh: "Kimi 开放平台余额（中国区）" },
    consoleUrl: "https://platform.kimi.com/console/api-keys",
    consoleName: { en: "Kimi Platform China API Keys", zh: "Kimi 开放平台中国区 API Keys" },
    expectedKey: {
      en: "Platform sk-… key (not sk-kimi-…)",
      zh: "开放平台 sk-… Key（不能是 sk-kimi-…）",
    },
    endpoint: "api.moonshot.cn",
    purpose: {
      en: "collecting available, voucher, and cash balances for a PAYG account",
      zh: "采集按量付费账户的可用、代金券和现金余额",
    },
  },
  platform_global: {
    title: {
      en: "Kimi API Platform balance (Global)",
      zh: "Kimi API Platform 余额（海外区）",
    },
    consoleUrl: "https://platform.kimi.ai/console/api-keys",
    consoleName: {
      en: "Kimi API Platform Global API Keys",
      zh: "Kimi API Platform 海外区 API Keys",
    },
    expectedKey: {
      en: "Platform sk-… key (not sk-kimi-…)",
      zh: "开放平台 sk-… Key（不能是 sk-kimi-…）",
    },
    endpoint: "api.moonshot.ai",
    purpose: {
      en: "collecting available, voucher, and cash balances for a Global PAYG account",
      zh: "采集海外按量付费账户的可用、代金券和现金余额",
    },
  },
};

function KimiGuide({ mode, compact }: { mode: KimiCredentialMode; compact?: boolean }) {
  const { locale, t } = useI18n();
  const guide = kimiGuides[mode];
  return (
    <GuideShell
      title={t(`How to configure ${guide.title.en}`, `如何配置 ${guide.title.zh}`)}
      compact={compact}
      summary={
        locale === "en" ? (
          <>
            This mode is for {guide.purpose.en} and only calls{" "}
            <InlineCode>{guide.endpoint}</InlineCode>. China and Global keys, and Kimi Code and
            Platform keys, are not interchangeable.
          </>
        ) : (
          <>
            此模式用于{guide.purpose.zh}，只会请求 <InlineCode>{guide.endpoint}</InlineCode>
            。中国区、海外区以及 Kimi Code、开放平台的 Key 均不可混用。
          </>
        )
      }
    >
      <ol className="list-decimal space-y-1 pl-5 text-[10px] leading-5">
        <li>
          {locale === "en" ? (
            <>
              <ExternalLink href={guide.consoleUrl}>Open {guide.consoleName.en}</ExternalLink> and
              sign in to the account that owns the key.
            </>
          ) : (
            <>
              <ExternalLink href={guide.consoleUrl}>打开{guide.consoleName.zh}</ExternalLink>，登录
              Key 所属账号。
            </>
          )}
        </li>
        <li>
          {t(
            "Create a key on the API Keys page. A new key is usually shown in full only once, so copy it immediately.",
            "进入 API Keys 页面创建 Key；新 Key 通常只会完整显示一次，请立即复制。",
          )}
        </li>
        <li>
          {locale === "en" ? (
            <>
              Confirm the key type is <InlineCode>{guide.expectedKey.en}</InlineCode>, then paste it
              below.
            </>
          ) : (
            <>
              确认 Key 类型为 <InlineCode>{guide.expectedKey.zh}</InlineCode>，再粘贴到下方输入框。
            </>
          )}
        </li>
      </ol>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        {t(
          "If verification returns 401, first confirm that Product and region exactly matches the site where the key was created instead of repeatedly creating new keys.",
          "如果验证返回 401，优先检查上方“产品与区域”是否和创建 Key 的网站完全一致，而不是反复生成新 Key。",
        )}
      </p>
      <SecretNotice />
    </GuideShell>
  );
}

export function CredentialGuide({
  provider,
  kimiMode = "code_cn",
  compact,
}: {
  provider: ProviderId;
  kimiMode?: KimiCredentialMode;
  compact?: boolean;
}) {
  if (provider === "codex" || provider === "grok") {
    return <AuthFileGuide provider={provider} compact={compact} />;
  }
  if (provider === "cursor") return <CursorGuide compact={compact} />;
  if (provider === "zenmux") return <ZenMuxGuide compact={compact} />;
  return <KimiGuide mode={kimiMode} compact={compact} />;
}
