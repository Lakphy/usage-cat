# 使用说明

面向已经部署或本地跑起来的使用者。凭据怎么准备见 [适配器与凭据](adapters.md)。

## 公开看板 `/`

任何人都能打开，不需要登录。页面展示所有未归档监控项的最新快照：

- 平台标记、显示名称、套餐、公开身份
- 状态：`pending`（尚未成功同步）、`healthy`、`action_required`（需要换凭据或适配器）
- 每个指标的剩余/已用摘要和进度条
- 上次同步的相对时间

看板文案写明：额度、余额和历史趋势是公开的，访问凭据不会出现在这个页面。

卡片点进去是 `/providers/<id>`。数据来自 `GET /api/v1/public/dashboard`，前端每 5 分钟自动刷新。

空状态表示还没有监控项，或 Worker / D1 不可用。

## 监控详情 `/providers/<id>`

- 切换单个指标
- 时间范围：24 小时、7 天、30 天、90 天、1 年
- `quota_window`（以及带上限的剩余额度）主值和折线都表示 **剩余**；`resetAt` 变化时折线断开，避免跨周期连成一条斜线
- `billing_counter` 可切换「累计」和「同账期增量」；跨账期不计算增量
- `balance` / `instant` 按采集值画
- 下方表格是最近快照（默认 20 条）

24 小时和 7 天请求原始点；更长范围由服务端按桶抽样，最多约 600 个桶。抽样规则见 [API 参考](api.md#get-apiv1publicintegrationsidhistory)。

## 语言和主题

顶栏可切换 English / 简体中文，写入 Cookie `usage_cat_locale`。Worker 在返回 `index.html` 时按 Cookie 改 `lang`、描述和 `window.__USAGE_CAT_LOCALE__`，避免首屏闪英文。

默认语言是 **English**。主题存在 `localStorage` 的 `usage-cat-theme`，未设置时跟随系统。

## 管理员登录 `/login`

公开看板不需要登录。点「管理」：

- 未登录：进 `/login`，用 GitHub 继续
- 已登录且 ID 在白名单：进 `/admin`
- GitHub 账号不在 `ADMIN_GITHUB_IDS`：`/login?error=forbidden`
- OAuth 失败或过期：`/login?error=github`

应用只读公开身份和数字用户 ID，不申请仓库权限。换到的 GitHub access token 在核对 ID 后立即丢弃，不会入库。会话 7 天，HttpOnly Cookie。

## 管理后台 `/admin`

需要有效管理员会话。可做的事：

| 操作 | 行为 |
| --- | --- |
| 查看监控项 | 含启用状态、周期、下次同步、最后错误码、是否已存凭据 |
| 新建 | 校验凭据格式 → 加密入库 → 立刻 `verify` 同步 |
| 修改名称 / 周期 / 启用 | 启用或改周期会检查 10 个启用上限和每天 1000 次计划同步预算 |
| 更换凭据 | 写入新的 `key_version`，把状态打回 `pending`，再 `verify` |
| 手动同步 | 202；同一监控项 30 秒内只能一次，否则 429 |
| 上移 / 下移 | 调整公开看板顺序；并发修改会 409 `ORDER_STALE` |
| 归档（删除） | 立即删加密凭据，监控项从公开列表消失；历史快照按保留策略继续留到最多 365 天 |
| 同步日志 | 最近 100 条 `sync_runs`，每 10 秒刷新 |

Kimi 必须在表单里显式选择产品与区域。系统**不会**拿同一把 Key 去多个区域探测。

## 状态怎么读

| `status` | 含义 | 你该做什么 |
| --- | --- | --- |
| `pending` | 刚创建或刚换凭据，还没有成功快照 | 等下一次同步，或点手动同步 |
| `healthy` | 最近一次成功 | 无需操作 |
| `action_required` | 不可重试且需要人工处理的错误（过期凭据、上游结构变了等） | 按 `last_error_code` 换凭据或等适配器更新 |
| `archived` | 已归档 | 不会再出现在列表里 |

错误码的中英说明见 [API 参考](api.md#错误码)。常见处理：

- `AUTH_EXPIRED` / `INVALID_CREDENTIAL`：按适配器文档重新录入
- `RATE_LIMITED`：加大刷新周期
- `UPSTREAM_SCHEMA_CHANGED`：上游改版，需要更新适配器，空等不会自己好
- `BROWSER_FALLBACK_COOLDOWN`：Kimi 的 Browser 回退熔断中，下一个周期会再试
