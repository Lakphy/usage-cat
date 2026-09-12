# Usage Cat

一个部署在 Cloudflare Workers 上的个人 AI 订阅用量看板。公开页面无需登录；配置页通过 GitHub 数字用户 ID 白名单保护。每次成功同步都向 D1 追加一条新快照，即使数据没有变化也不会覆盖旧记录。

支持的平台：Codex、Cursor、Grok、ZenMux Subscription、Kimi Code，以及 Kimi 中国区/海外区开放平台余额。ZenMux 和 Kimi 开放平台余额使用官方接口；其余个人订阅用量接口可能随上游产品改版，界面会标记为 Beta。

完整文档（本地入门、部署、适配器、API、安全与开发）见 [`docs/`](docs/README.md)。macOS 状态栏客户端见 [`client/macos`](client/macos/README.md)。

## 技术栈

- Cloudflare Workers、D1、Queues、Cron Triggers、Static Assets
- React 19、Vite、Hono
- TanStack Router、TanStack Query、React Hook Form、Zod
- Tailwind CSS v4、shadcn Lyra（默认中性色）、Recharts
- Vitest（包括 Workers Runtime + D1 集成测试）、Biome

## macOS 状态栏客户端

`client/macos` 是原生 Swift 菜单栏小程序，填写公开看板地址后即可在右上角查看全部用量。

```bash
cd client/macos
./scripts/build.sh
open "dist/Usage Cat.app"
```

## 本地开发

要求 Node.js 22+ 和 pnpm 10+。

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

生成一个 32 字节的加密密钥并写入 `.dev.vars`：

```bash
openssl rand -base64 32
```

GitHub OAuth App 的本地回调地址应设为：

```text
http://localhost:5173/api/v1/auth/github/callback
```

`.dev.vars` 中的 `ADMIN_GITHUB_IDS` 是逗号分隔的 GitHub 数字用户 ID，不是用户名。可以从 `https://api.github.com/users/<用户名>` 返回的 `id` 字段获取。

## 部署到 Cloudflare

1. 登录并创建免费资源：

```bash
pnpm wrangler login
pnpm wrangler d1 create usage-cat
pnpm wrangler queues create usage-cat-sync
```

2. 将 D1 命令返回的 `database_id` 写入 `wrangler.jsonc`，并将 `APP_URL` 改为最终的 HTTPS 站点地址。生产 GitHub OAuth App 的回调地址必须精确设为：

```text
https://你的域名/api/v1/auth/github/callback
```

3. 配置 Worker Secrets：

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put ADMIN_GITHUB_IDS
pnpm wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

`CREDENTIAL_ENCRYPTION_KEY` 必须是 32 字节随机值的 Base64 表示。不要在密钥丢失后直接替换它，否则已有凭据将无法解密；应先在后台重新录入所有平台凭据。

4. 应用迁移并部署：

```bash
pnpm db:migrate:remote
pnpm run deploy
```

首次部署如果使用 `workers.dev` 地址，可先部署取得地址，再回填 `APP_URL`、GitHub 回调地址并重新部署。

## 各平台凭据

| 平台 | 后台录入内容 | 采集接口 | 稳定性 |
| --- | --- | --- | --- |
| Codex | 独立 `CODEX_HOME/auth.json` | ChatGPT Codex usage + OAuth refresh | Beta / 内部接口 |
| Cursor | `crsr_...` User API Key | Dashboard Connect RPC | Beta / 内部接口 |
| Grok | 独立 `GROK_HOME/auth.json` | Grok CLI billing/settings + OIDC refresh | Beta / 内部接口 |
| ZenMux | `sk-mg-v1-...` Management API Key | `/api/v1/management/subscription/detail` | 官方接口 |
| Kimi | Kimi Code 或开放平台 API Key，并显式选择产品与区域 | Kimi Code `/coding/v1/usages`；开放平台 `/v1/users/me/balance` | 开放平台余额为官方接口；Code 用量为 Beta |

Codex 和 Grok 建议在临时、隔离的配置目录中完成 CLI 登录，再上传生成的 `auth.json`。后台只提取访问令牌、刷新令牌、账号/客户端标识和过期时间，不保存原文件的其他内容。凭据由 AES-256-GCM 加密，AAD 绑定监控项 ID、平台和密钥版本。

所有上游主机都固化在代码中，后台不能配置自定义 Base URL，以避免 SSRF。任何同步错误都只保存经过裁剪的错误码和消息，不记录令牌或上游完整响应。

ZenMux 的 `sk-ss-v1-...` 是订阅模型调用 Key，`sk-ai-v1-...` 是 PAYG 模型调用 Key，二者都不能访问账户用量接口。监控订阅额度需要在 ZenMux Console 的 Management 页面另行创建 `sk-mg-v1-...` Management API Key。

Kimi 必须选择与 Key 来源一致的产品和区域，系统不会把 Key 自动发送到多个区域探测：

- Kimi Code 中国区：`https://api.kimi.com/coding/v1/usages`
- Kimi Code 海外区：`https://api.kimi.ai/coding/v1/usages`
- 开放平台中国区：`https://api.moonshot.cn/v1/users/me/balance`，余额单位 CNY
- 开放平台海外区：`https://api.moonshot.ai/v1/users/me/balance`，余额单位 USD

## 数据与图表语义

- `quota_window`：主值和折线统一展示剩余额度；同时保留已用百分比；`resetAt` 变化时折线断开。
- `billing_counter`：可切换累计值和同账期增量；跨账期不计算增量。
- `balance`：按余额值显示。
- `instant`：展示采集时刻的瞬时值。
- 24 小时和 7 天返回原始点；更长范围在 D1 中按桶取峰值与最新值，最多约 600 个桶。
- 90 天内保留每一条原始快照；91–365 天每个监控项每天保留最后一条代表快照；归档监控项会立即删除加密凭据，但历史快照按同一策略继续存在。

公开 API：

```text
GET /api/v1/public/dashboard
GET /api/v1/public/integrations/:id/history?metric=&from=&to=
GET /api/v1/public/integrations/:id/snapshots?cursor=&limit=
```

## 免费套餐预算

系统限制最多 10 个启用的监控项、刷新周期最短 5 分钟，并把所有启用项的计划同步总量限制为每天 1,000 次。Cloudflare Queue 的正常开销约为每天 3,000 次操作（写入、读取、确认）；即使每条消息都达到配置的 5 次重试，理论上约为 8,000 次，仍为验证和手动同步留出余量。每次成功同步只写一条 JSON 快照，避免按指标拆行造成额外 D1 写入；旧数据按“90 天原始点 + 一年每日点”压缩，使最坏配置也能长期控制在 D1 免费容量内。

## 适配器契约与维护

适配器不共享猜测型字段映射，而是各自维护认证、刷新、响应解析和错误分类。Codex、Cursor、Grok 的个人订阅接口不是稳定公共 API，因此对应实现固定 adapterVersion，并用当前官方客户端响应形状的 fixture 做契约测试；上游字段无法识别时会明确记录 UPSTREAM_SCHEMA_CHANGED，不会写入空快照。

- Codex：依据 OpenAI Codex 官方客户端的 wham/usage 和 OAuth refresh 实现。
- Cursor：依据官方客户端当前发布包内的 Dashboard Connect RPC 描述；分别采集 Cursor Models、Other Models 与 Grok Bot 周额度，未启用 On-Demand 时不生成虚假零值。
- Grok：依据 xAI grok-build 官方源码中的 billing、settings、auth.json 与 OIDC refresh 契约。
- ZenMux：依据公开的 Subscription Detail API，usage_percentage 按官方 0–1 比例转换。
- Kimi Code：依据 MoonshotAI kimi-code 官方源码中的中国区/海外区 managed usage 与 Booster wallet 定点金额模型。
- Kimi 开放平台：依据中国区和海外区官方余额 API，分别解析可用余额、代金券余额和现金余额。

所有请求固定 HTTPS 上游、禁止跳转、10 秒超时、最大 1 MB JSON 响应；401/403、限流、临时 5xx、OAuth 失效和结构漂移分别进入不同重试/告警路径。更新适配器时，应先替换对应 tests/fixtures/*.json 契约样本，再调整解析器并运行完整质量检查。

实际配额以 Cloudflare 当前定价页为准。若开启接近上限的配置，请同时观察 Workers CPU、D1 写入和 Queue 用量。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run
```

适配器测试覆盖凭据裁剪、数字字符串、窗口映射和错误输入；Workers 集成测试运行在 Cloudflare runtime 中并使用真实 D1 binding，验证公开访问与快照追加语义。
