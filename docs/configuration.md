# 配置参考

环境变量、Wrangler 绑定和密钥的完整列表。怎么填见 [本地入门](getting-started.md) 和 [部署](deploy.md)。

## 密钥与本地变量

生产用 `wrangler secret`；本地用 `.dev.vars`（已被 gitignore）。`.dev.vars.example` 只有占位符。

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | 是 | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | 是 | GitHub OAuth App Client Secret |
| `ADMIN_GITHUB_IDS` | 是 | 逗号分隔的 GitHub **数字**用户 ID。空白项会被丢掉。不在名单内的登录会重定向到 `/login?error=forbidden`，已有会话也会在下次请求时失效 |
| `CREDENTIAL_ENCRYPTION_KEY` | 是 | 32 字节随机值的标准 Base64。解码后长度不是 32 字节会在加解密时抛错 |
| `APP_URL` | 是 | 站点 origin，见下方 Wrangler `vars`。本地由 `wrangler.jsonc` 的值或开发插件注入；生产必须是最终 HTTPS 地址 |

代码里通过 `src/worker/env.ts` 的 `Env` 读取以上字段。没有默认值。

## Wrangler：`wrangler.jsonc`

| 字段 | 当前值 | 含义 |
| --- | --- | --- |
| `name` | `usage-cat` | Worker 名称 |
| `main` | `src/worker/index.ts` | Worker 入口 |
| `compatibility_date` | `2026-09-11` | Workers 兼容日期 |
| `compatibility_flags` | `["nodejs_compat"]` | 适配 `@cloudflare/puppeteer` 等 Node API |
| `assets.directory` | `./dist/client` | 前端构建产物 |
| `assets.binding` | `ASSETS` | Worker 里取静态资源 |
| `assets.not_found_handling` | `single-page-application` | 前端路由回退到 `index.html` |
| `assets.run_worker_first` | `/`、`/admin`、`/login`、`/providers/*`、`/api/*` | 这些路径先走 Worker（文档本地化、API、鉴权） |
| `browser.binding` | `BROWSER` | Browser Rendering，Kimi 回退用，可选能力 |
| `routes` | 维护者生产域名 | 自定义域；自托管时改掉或删除 |
| `d1_databases` | binding `DB`，库名 `usage-cat` | 见下 |
| `queues` | `usage-cat-sync` | 见下 |
| `triggers.crons` | `*/5 * * * *`，`17 19 * * *` | 见 [运行与配额](operations.md) |
| `vars.APP_URL` | 维护者生产 URL | 非密钥，但必须是你的站点 origin |
| `observability` | 开启，采样率 `0.05` | Cloudflare 观测 |

D1：

- binding 名必须是 `DB`
- `migrations_dir` 为 `migrations/`
- `database_id` 换成 `wrangler d1 create` 返回的 ID

Queue：

| 项 | 值 | 含义 |
| --- | --- | --- |
| producer binding | `SYNC_QUEUE` | Worker 入队 |
| queue 名 | `usage-cat-sync` | 需先 `wrangler queues create` |
| `max_batch_size` | `1` | 一次只处理一条同步 |
| `max_batch_timeout` | `1` | 秒 |
| `max_retries` | `5` | 与 `processSync` 里 `attempt < 5` 的可重试上限配合 |
| `max_concurrency` | `1` | 同时只跑一条消费者，降低上游限流 |

## 前端与构建

| 文件 | 作用 |
| --- | --- |
| `vite.config.ts` | React、Tailwind、TanStack Router、Cloudflare Vite 插件 |
| `tsconfig.app.json` / `tsconfig.node.json` | 应用与 Node 侧 TypeScript |
| `biome.json` | lint / format；`src/routeTree.gen.ts` 和 `dist` 被排除 |
| `components.json` | shadcn Lyra、中性色、Phosphor 图标 |
| `public/_headers` | 静态资源安全头（CSP、`X-Frame-Options` 等） |

路径别名 `@/` 指向 `src/`。

## Cookie 与本地存储

| 名称 | 位置 | 用途 |
| --- | --- | --- |
| `usage_cat_session` | Cookie，HttpOnly，SameSite=Lax，7 天 | 管理员会话。值是随机 token，库里只存 SHA-256 |
| `usage_cat_oauth` | Cookie，HttpOnly，10 分钟 | GitHub OAuth 的加密 `state` + PKCE verifier |
| `usage_cat_locale` | Cookie，1 年 | `en` 或 `zh-CN` |
| `usage-cat-theme` | `localStorage` | `dark` / `light`；未设置则跟随系统 |

`Secure` 仅当 `APP_URL` 为 `https:` 时启用，所以本地 `http://localhost:5173` 可以种 Cookie。

## 代码内硬限制

定义在 `src/worker/limits.ts` 与 Zod schema，不能用环境变量改：

| 限制 | 值 |
| --- | --- |
| 最多同时启用的监控项 | 10 |
| 所有启用项计划同步之和 | 每天 1000 次（`1440 / interval_minutes` 求和） |
| 刷新周期 | 5–1440 分钟 |
| 显示名称 | 1–80 字符 |
| API Key 最大长度 | 4096 |
| `auth.json` 最大长度 | 128 000 |
| 手动同步间隔 | 同一监控项 30 秒 |
| 快照原始保留 | 90 天 |
| 快照最长保留 | 365 天（90 天之后每天只留最后一条） |
| 无快照的 `sync_runs` | 30 天后删除 |
| 上游请求超时 | 10 秒 |
| 上游响应体上限 | 1 MB |
| 同步租约 | 120 秒 |

这些限制是为了把最坏配置压在 Cloudflare 免费套餐附近，不是平台硬配额。
