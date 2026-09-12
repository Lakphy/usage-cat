# 数据模型

D1 表由 `migrations/` 管理。时间字段都是 Unix 秒。本页描述当前 schema（迁移 0001–0006 全部应用后）。

## 表

### `integrations`

一个监控项一行。

| 列 | 说明 |
| --- | --- |
| `id` | UUID |
| `provider` | `codex` / `cursor` / `grok` / `zenmux` / `kimi` |
| `display_name` | 公开显示名 |
| `public_identity` | 成功同步后写入的邮箱或用户名，会出现在公开 API |
| `plan_name` | 上游套餐名 |
| `status` | `pending` / `healthy` / `action_required` / `archived` |
| `enabled` | 0/1。归档时强制 0 |
| `interval_minutes` | 5–1440 |
| `next_sync_at` | 下次计划调度 |
| `last_synced_at` | 最近一次成功 |
| `last_error_code` | 最近一次错误码 |
| `sort_order` | 公开列表顺序，新建为当前最大 + 100 |
| `browser_fallback_disabled_until` | Kimi Browser 回退熔断截止时间 |
| `created_at` / `updated_at` | |
| `archived_at` | 非空即归档，公开列表不再出现 |

启用项的计划同步之和由 D1 TRIGGER 限制为每天 1000 次，与应用层校验双保险。见 `migrations/0004_expand_sync_budget.sql`。

### `credential_secrets`

| 列 | 说明 |
| --- | --- |
| `integration_id` | PK，外键级联 |
| `encrypted_payload` | AES-256-GCM 密文（Base64） |
| `nonce` | 12 字节 IV（Base64） |
| `key_version` | 参与 AAD。创建为 1；更换凭据时换成随机新版本，避免进行中的刷新覆盖管理员刚写入的新凭据 |
| `updated_at` | |

明文形状见 `StoredCredential`（`src/worker/adapters/types.ts`）。归档时 **立刻 DELETE** 这一行。

### `sync_runs`

| 列 | 说明 |
| --- | --- |
| `id` | UUID，快照的 `sync_run_id` |
| `trigger_type` | `schedule` / `manual` / `verify` |
| `status` | `queued` / `running` / `succeeded` / `failed` |
| `attempt` | 抢租约时 +1 |
| `lease_token` / `lease_expires_at` | 120 秒租约，防重入 |
| `dedupe_key` | 计划调度去重，`schedule:<integrationId>:<scheduledAt>` |
| `enqueued_at` | 成功写入 Queue 的时间 |
| `error_code` / `error_message` | 失败时写入；消息最多 300 字符，不含 token |

### `sync_outbox`

Queue 发送的可靠缓冲。`run_id` 为主键。发送成功即删除。发送失败增加 `attempts`，`available_at` 指数退避（15×2^n，上限 900 秒）。

### `usage_snapshots`

每次成功同步 **插入** 一行，不更新旧行。`sync_run_id` 唯一，一次 run 最多一条快照。

| 列 | 说明 |
| --- | --- |
| `payload_json` | 下面的快照对象 |
| `captured_at` | 适配器写入的采集时刻 |
| `schema_version` | 目前恒为 1 |

### `admin_sessions` / `oauth_states`

会话只存 `token_hash`（SHA-256）以及 GitHub 用户 ID、login、头像 URL、过期时间。`oauth_states` 表在初始迁移里创建，当前 OAuth state 改走加密 Cookie，这张表仍会被每日清理任务清空过期行。

## 快照 JSON

Zod：`snapshotPayloadSchema`。

```json
{
  "schemaVersion": 1,
  "provider": "kimi",
  "capturedAt": 1700000000,
  "identity": { "username": "optional", "email": "optional" },
  "plan": "optional",
  "metrics": [],
  "source": { "adapterVersion": "kimi/5" }
}
```

`metrics` 至少一项，`key` 在同一快照内唯一。每条指标：

| 字段 | 约束 |
| --- | --- |
| `key` | 1–100 字符，稳定 ID，图表用它请求历史 |
| `label` | 1–100，中文主标签；英文 UI 会查表或做窗口名替换 |
| `kind` | 见下 |
| `unit` | 如 `%`、`USD cents`、`flow`、`CNY` |
| `used` / `value` | 至少一个必须存在 |
| `limit` / `remaining` / `percentage` | 可选；`percentage` 0–100 |
| `periodStart` / `periodEnd` / `resetAt` | Unix 秒 |

### `kind` 语义

| `kind` | 看板主值 | 折线 | 说明 |
| --- | --- | --- | --- |
| `quota_window` | 剩余额度 | 剩余；`resetAt` 变则断开 | 同时保留已用百分比 |
| `billing_counter` | 累计 used | 可切换同账期增量 | 跨账期增量记为断点（`null`） |
| `balance` | `value`（否则 `used`） | 余额 | |
| `instant` | 采集时刻的值 | 原值 | 例如 ZenMux 月度 Flow 上限 |

「剩余语义」判定：`kind === quota_window`，或 `limit > 0` 且有 `remaining` 或 `used`。公开历史 SQL 用同一规则给每桶选峰值（剩余则取更低剩余，即更差的那次）。

## 保留策略

每日 Cron `17 19 * * *`（UTC 19:17）跑 `cleanupExpiredData`，每批有 LIMIT，一天跑不完下一天继续。

| 数据 | 策略 |
| --- | --- |
| 快照 | 365 天以前的全部删除 |
| 快照 | 90–365 天：每个监控项每个 UTC 日只留 `captured_at`/`id` 最大的一条 |
| 快照 | 90 天以内：全部保留 |
| `sync_runs` | 30 天以前、且没有关联快照的删除（成功且仍被快照引用的会留下） |
| 会话 / oauth_states | `expires_at < now` 删除 |
| 归档监控项的凭据 | 归档当下删除 |
| 归档监控项的快照 | 走同一 90/365 天规则 |

设计目标：10 个启用项、最短 5 分钟、每天 1000 次计划同步时，D1 行数仍能长期停在免费容量附近。每次成功只写 **一条** JSON 快照，不按指标拆行。
