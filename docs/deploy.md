# 部署到 Cloudflare

把 Usage Cat 发布到你自己的 Cloudflare 账号。配置项含义见 [配置参考](configuration.md)。

本仓库跟踪的 `wrangler.jsonc` 绑定了维护者的生产域名和 D1。你必须改成自己的资源，否则 `wrangler deploy` 会撞上别人的域名绑定。

## 需要创建的资源

| 资源 | 名称（可改，需与配置一致） | 用途 |
| --- | --- | --- |
| Worker | `usage-cat` | 应用本体 |
| D1 | `usage-cat` | 监控项、加密凭据、快照、会话 |
| Queue | `usage-cat-sync` | 同步任务 |
| Cron | 已写在 `wrangler.jsonc` | 调度与清理 |
| Browser Rendering | binding 名 `BROWSER` | 仅 Kimi 在撞上 Cloudflare challenge 时的回退；没有也能跑，只是该回退不可用 |
| 自定义域名 | 可选 | 没有的话先用 `*.workers.dev` |

免费套餐预算按「最多 10 个启用监控项、每天约 1000 次计划同步」设计，计算见 [运行与配额](operations.md)。实际配额以 Cloudflare 当前定价页为准。

## 1. 登录并创建存储

```bash
pnpm wrangler login
pnpm wrangler d1 create usage-cat
pnpm wrangler queues create usage-cat-sync
```

把 `d1 create` 输出的 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

## 2. 改 `wrangler.jsonc`

至少改这几处：

- `routes`：换成你的域名，或暂时删掉整个 `routes` 数组，先用 `workers.dev`
- `vars.APP_URL`：最终 HTTPS 源站，例如 `https://usage.example.com`，**不要**带尾斜杠
- `d1_databases[0].database_id`
- 若 Queue 名称不是 `usage-cat-sync`，同步改 `queues.producers` 和 `queues.consumers`

`APP_URL` 会用于：

- GitHub OAuth 回调
- 会话 Cookie 的 `Secure`（仅 HTTPS 时开启）
- 写操作的 Origin 校验

首次若还没有自定义域名：先部署拿到 `https://<worker>.<account>.workers.dev`，把这个地址填进 `APP_URL` 和 GitHub 回调，再部署一次。

## 3. 生产 GitHub OAuth App

不要复用本地 OAuth App。新建一个：

- Homepage URL：与 `APP_URL` 相同
- Authorization callback URL **必须精确**为：

```text
https://你的域名/api/v1/auth/github/callback
```

把 Client ID / Secret 放到 Worker Secrets，不要写进 `wrangler.jsonc`。

## 4. 配置 Worker Secrets

```bash
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm wrangler secret put ADMIN_GITHUB_IDS
pnpm wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

`CREDENTIAL_ENCRYPTION_KEY` 必须是 32 字节随机值的 Base64：

```bash
openssl rand -base64 32
```

**不要在密钥丢失后直接替换它。** 已有 `credential_secrets` 将无法解密。正确做法是先在后台重新录入所有平台凭据，或接受旧监控项失效。本地 `.dev.vars` 的密钥不要拿到生产。

## 5. 迁移并发布

```bash
pnpm db:migrate:remote
pnpm run deploy
```

`pnpm run deploy` 等于 `pnpm build && wrangler deploy`。静态资源从 `dist/client` 作为 Worker Assets 发布；Worker 入口是 `src/worker/index.ts`。

## 6. 发布后检查

1. 打开 `APP_URL`，公开看板应返回 200。
2. `/api/v1/health` 应返回 `{"ok":true}`。
3. 用白名单 GitHub 账号登录 `/admin`。
4. 添加一个监控项，确认 `verify` 同步成功、公开页出现卡片。

若 GitHub 回调报错，优先核对：回调 URL 是否与 `APP_URL` 主机完全一致（含 `www`、协议、路径）、OAuth App 是否用了生产 Client ID。

## 自定义域名

`wrangler.jsonc` 使用 `custom_domain: true` 的 `routes`。域名需已接入该 Cloudflare 账号。也可以在 Dashboard 里给 Worker 绑域名，再把 `APP_URL` 改成该 HTTPS 地址并重新部署。

## Browser Rendering

`wrangler.jsonc` 声明了 `browser.binding = "BROWSER"`。Kimi 适配器在直连收到 `403` 且 `cf-mitigated: challenge`、或同步重试时网络失败，才会用它再打一遍上游。

- 账号未开通 Browser Rendering 时，binding 可能不可用；Kimi 仍走直连，challenge 会被当成限流/失败，而不会崩溃整个 Worker。
- 回退失败后该监控项会进入约 1 小时熔断，避免打满 Browser Rendering 免费额度。见 [运行与配额](operations.md#kimi-browser-回退)。

## 之后更新

```bash
pnpm db:migrate:remote   # 仅当 migrations/ 有新文件
pnpm run deploy
```

不要改已经应用过的迁移文件；只追加新的 `000N_*.sql`。
