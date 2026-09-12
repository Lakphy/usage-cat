# 适配器与凭据

每个平台一个适配器，认证、刷新、解析和错误分类都不互相「猜字段」。上游主机写死在代码里，后台不能填自定义 Base URL。

凭据等同密码：只在管理后台提交，不要发到聊天、工单或 git。服务器只抽出同步所需字段，AES-256-GCM 加密后存储。细节见 [安全](security.md)。

Codex、Cursor、Grok、Kimi Code 使用的不是稳定公共 API，界面标 Beta。ZenMux 订阅详情和 Kimi 开放平台余额是官方接口。使用非官方适配器可能违反上游条款，见 [安全](security.md#上游接口与使用条款)。

## 总览

| `provider` | 后台录入 | 默认周期 | Beta | 采集地址 |
| --- | --- | --- | --- | --- |
| `codex` | 隔离目录的 `auth.json` | 15 分钟 | 是 | `https://chatgpt.com/backend-api/wham/usage` |
| `cursor` | `crsr_…` User API Key | 60 分钟 | 是 | `https://api2.cursor.sh` Dashboard Connect RPC |
| `grok` | 隔离目录的 `auth.json` | 60 分钟 | 是 | `https://cli-chat-proxy.grok.com/v1/billing` |
| `zenmux` | `sk-mg-v1-…` Management Key | 30 分钟 | 否 | `https://zenmux.ai/api/v1/management/subscription/detail` |
| `kimi` | API Key + 显式 `credentialMode` | 15 分钟 | Code 为是，开放平台余额为否 | 见下方 Kimi |

`adapterVersion` 写在每条快照的 `source.adapterVersion`（例如 `codex/3`、`cursor/4`、`grok/3`、`zenmux/2`、`kimi/5`）。改解析逻辑时应升版本，并先换 `tests/fixtures/` 再改代码。

---

## Codex

录入 **ChatGPT 登录产生的 `auth.json`**。OpenAI Platform API Key 读不到 Codex 会员额度。

推荐隔离登录，避免云端刷新 refresh token 弄掉你日常 Codex 会话：

```bash
# macOS / Linux
mkdir -p ~/.usage-cat-codex && CODEX_HOME="$HOME/.usage-cat-codex" codex login
```

```powershell
# Windows PowerShell
$env:CODEX_HOME="$HOME\.usage-cat-codex"; codex login
```

登录方式选 “Sign in with ChatGPT”。成功后上传 `~/.usage-cat-codex/auth.json`（Windows 为 `%USERPROFILE%\.usage-cat-codex\auth.json`）。文件名必须是 `auth.json`，不是 `os.json`。

默认 `~/.codex/auth.json` 也可以，但若该路径不存在，登录信息往往在系统钥匙串里，隔离命令才能得到可上传文件。

服务器从 JSON 中提取：`access_token`、`refresh_token`、可选 `id_token`、`account_id`、过期时间。刷新走 `https://auth.openai.com/oauth/token`，`client_id` 为官方 Codex CLI 的公开 PKCE 客户端 `app_EMoamEEZ73f0CkXaXp7hrann`。采集请求带 `chatgpt-account-id`。

典型指标：`codex-primary` / `codex-secondary`（主/次窗口百分比）、额外窗口、`codex-credits`、`codex-spend-control`。

---

## Cursor

录入个人 **User API Key**（`crsr_` 前缀）。不要用团队 Admin Key（常以 `key_` 开头），也不要填 Cursor Models 里的 OpenAI / Anthropic 厂商 Key。

1. 打开 [Cursor Dashboard](https://cursor.com/dashboard) → Integrations
2. User API Keys → 创建
3. 立刻复制完整 `crsr_…` 粘贴到后台

同步时先 `POST /auth/exchange_user_api_key` 换成短时 access token，再调用：

- `GetCurrentPeriodUsage`（必须成功）
- `GetPlanInfo`、`GetMe`、`GetSandUsageStatus`（失败则当作空元数据，不让整次同步失败）

指标对齐 Spending 页：Cursor Models、Other Models、Grok Bot 周额度。未启用 On-Demand 时 **不会**造一条 0 元的按量指标。

官方企业 Analytics / Admin API 解决不了个人 Pro 用量，因此这里走 Dashboard Connect RPC。

---

## Grok

录入 Grok Build CLI 的 `auth.json`，不要用 `console.x.ai` 的模型 API Key。

```bash
mkdir -p ~/.usage-cat-grok && GROK_HOME="$HOME/.usage-cat-grok" grok login
```

上传 `~/.usage-cat-grok/auth.json`。实现依据 [xai-org/grok-build](https://github.com/xai-org/grok-build)（Apache-2.0）里的 billing / settings / OIDC 契约。

必须能解析到 access token（字段 `key` 或 `access_token`）和 `user_id`。若带 refresh token，还需要 `oidc_issuer = https://auth.x.ai` 与 `oidc_client_id`。其它 issuer 会被拒绝。

采集：`GET /v1/billing?format=credits` 与 `GET /v1/settings`，请求头包含 `x-xai-token-auth: xai-grok-cli`、`x-grok-client-mode: headless`、`x-userid`。

典型指标：`grok-included-credits`、`grok-included-legacy`、`grok-on-demand`、`grok-prepaid-balance`。

---

## ZenMux Subscription

只要 Management API Key，前缀必须是 `sk-mg-v1-`。

1. 登录 [ZenMux](https://zenmux.ai/platform/management)，确认头像菜单是个人账号
2. Management 页面创建 Management API Key
3. 粘贴 `sk-mg-v1-…`

会被拒绝：

- `sk-ss-v1-…` 订阅推理 Key
- `sk-ai-v1-…` PAYG 推理 Key

官方 `usage_percentage` 是 0–1，适配器乘 100。指标：`zenmux-5h`、`zenmux-7d`、`zenmux-monthly-cap`（月度上限以 `instant` 记录，不是用量曲线）。

---

## Kimi

必须选择与 Key 来源一致的 `credentialMode`。Key **不会**被发到其它区域。

| `credentialMode` | 控制台 | Key | 上游 |
| --- | --- | --- | --- |
| `code_cn` | [kimi.com/code/console](https://www.kimi.com/code/console) | `sk-kimi-…` | `https://api.kimi.com/coding/v1/usages` |
| `code_global` | [kimi.ai/code/console](https://www.kimi.ai/code/console) | `sk-kimi-…` | `https://api.kimi.ai/coding/v1/usages` |
| `platform_cn` | [platform.kimi.com](https://platform.kimi.com/console/api-keys) | 开放平台 `sk-…`（不能是 `sk-kimi-`） | `https://api.moonshot.cn/v1/users/me/balance`，单位 CNY |
| `platform_global` | [platform.kimi.ai](https://platform.kimi.ai/console/api-keys) | 开放平台 `sk-…`（不能是 `sk-kimi-`） | `https://api.moonshot.ai/v1/users/me/balance`，单位 USD |

Kimi Code 采集每周额度、窗口限额和 Booster 钱包（定点金额 / `1_000_000` 转为美分）。开放平台采集 `available_balance`、`voucher_balance`、`cash_balance`。

User-Agent 为 `usage-cat/1.0 (+https://usage.lakphy.me)`，标识第三方工具，不伪装官方 CLI。Kimi 文档要求第三方不要篡改成官方客户端标识。

直连若收到 Cloudflare challenge，且 Worker 绑定了 Browser Rendering，会走浏览器回退；失败则熔断约 1 小时。见 [运行与配额](operations.md#kimi-browser-回退)。

诊断脚本（交互输入 Key，不落盘）：

```bash
bash scripts/test-kimi-key.sh
```

不要把 Key 贴到 issue 或聊天里。

---

## 共同的请求规则

所有适配器经 `requestJson`：

- 只允许 HTTPS 上游，`redirect: manual`，3xx 视为 `UPSTREAM_SCHEMA_CHANGED`
- 默认 10 秒超时、响应最大 1 MB
- `401/403`（可按适配器覆盖）→ `AUTH_EXPIRED`，不重试，需要人工处理
- `429`（Kimi 另含部分 `403`，ZenMux 另含 `422`）→ `RATE_LIMITED`，可重试，尊重 `Retry-After`
- `408/425/5xx` → `UPSTREAM_UNAVAILABLE`，可重试（Kimi 另把 `402` 视为可重试）
- 2xx 但不是 JSON，或一个指标都解析不出来 → `UPSTREAM_SCHEMA_CHANGED`，不写空快照

OAuth 刷新若返回 `invalid_grant` / `invalid_token` / refresh token 失效，同样记 `AUTH_EXPIRED`。
