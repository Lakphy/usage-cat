# 运行与配额

同步管道、Cron、Queue、重试和免费套餐保护。架构概览见 [架构说明](architecture.md)。

## Cron

`wrangler.jsonc` → `triggers.crons`：

| 表达式 | UTC 含义 | 函数 |
| --- | --- | --- |
| `*/5 * * * *` | 每 5 分钟 | `scheduleDueIntegrations`：回收租约、冲出箱、调度到期项 |
| `17 19 * * *` | 每天 19:17 | `cleanupExpiredData`：快照压缩与过期会话 |

每次最多调度 **10** 个到期监控项。若启用项很多且都挤在同一分钟，需要后续 5 分钟节拍才能排完。最短刷新周期也是 5 分钟，与 Cron 对齐。

## 同步触发源

| `trigger_type` | 何时 | 去重 |
| --- | --- | --- |
| `schedule` | Cron 发现 `next_sync_at <= now` | `schedule:<id>:<scheduledAt>` |
| `verify` | 创建监控项或更换凭据 | 无 |
| `manual` | 后台按钮；30 秒冷却 | 无 |

## Queue

队列名 `usage-cat-sync`，消费者：

- `max_batch_size = 1`，`max_concurrency = 1`：同一时刻只跑一条采集
- `max_retries = 5`：与 `processSync` 中 `retryable && attempt < 5` 一致
- 可重试时 `message.retry({ delaySeconds })`：优先用上游 `Retry-After`（1–3600 秒），否则 `min(300, 15 * 2^(attempts-1))`
- 成功或不可重试则 `ack`

出箱发送失败（还没进 Queue）不走 Queue retry，而在 D1 里推迟 `available_at`。

## 租约与恢复

`processSync` 把 run 从 `queued`（或租约过期的 `running`）改为 `running`，`lease_expires_at = now + 120`，并写入随机 `lease_token`。后续所有 UPDATE 都带这个 token：被别人抢走租约后，旧执行写不进快照、也改不了凭据。

Cron 会把 `lease_expires_at < now` 的 `running` 打回 `queued`，并把「queued 但 5 分钟还没 `enqueued_at`」的 run 重新插入出箱。

## 成功路径

1. 解密凭据（AAD 含 `key_version`）
2. `prepareCredential`（若有）刷新 token；有变化则立刻加密写回
3. `collect`；若 `AUTH_EXPIRED` 则强制刷新再 collect 一次
4. 同一 batch：插入快照、监控项标 `healthy`、写入 `public_identity` / `plan_name`、清除 Browser 熔断、run 标 `succeeded`

快照是 INSERT。相同用量也会多一行，这是有意的。

## 失败路径

`safeError` 把异常收成 `AdapterError`。

| 条件 | 监控项 | run | Queue |
| --- | --- | --- | --- |
| `retryable && attempt < 5` | 保持原 status，记录 `last_error_code` | 回到 `queued` | `retry` |
| 不可重试且 `actionRequired` | `action_required` | `failed` | `ack` |
| 不可重试且非 actionRequired | 不改 status（例如 Browser 失败） | `failed` | `ack` |
| `BROWSER_FALLBACK_FAILED` | `browser_fallback_disabled_until = now+3600` | `failed` | `ack` |

缺少监控项或凭据：`MISSING_CONFIG`，直接 failed。

## Kimi Browser 回退

仅 `kimi` 适配器。

1. 先用 Worker `fetch` 打官方 HTTPS 端点。
2. 若响应 `403` 且 `cf-mitigated: challenge`，并且 `env.BROWSER` 存在、未熔断：用 `@cloudflare/puppeteer` 再请求一次（15 秒导航超时，1 MB 上限）。
3. 若直连抛网络错误，且 `syncAttempt >= 2`、有 Browser：同样回退。
4. 回退抛错 → `BROWSER_FALLBACK_FAILED` → 该监控项 1 小时内不再走 Browser，以免打满 Browser Rendering 免费额度。
5. 熔断期内再碰到需要回退的情况 → `BROWSER_FALLBACK_COOLDOWN`。
6. 成功同步会把 `browser_fallback_disabled_until` 清掉。

没有 Browser binding 时，challenge 对 Kimi 来说会落进 `rateLimitStatuses`（含 403），表现为可重试的 `RATE_LIMITED`。

## 计划同步预算

应用层 + D1 TRIGGER 同时限制：

```
Σ (1440 / interval_minutes)  ≤  1000     （仅 enabled 且未归档）
启用监控项数                 ≤  10
interval_minutes             ≥  5
```

例：10 个项、都是 15 分钟 → `10 * 96 = 960` 次/天。10 个项都用 5 分钟 → `10 * 288 = 2880`，会被拒绝。

代码注释中的 Queue 估算（以当前 Cloudflare 免费队列 1 万次操作为背景，**以官网为准**）：

- 正常投递约 3 次操作/消息（写、读、确认）
- 每天 1000 条计划消息 → 约 3000 次操作
- 若每条都用满配置的 5 次重试，理论上约 8000，仍给 `verify` / 手动同步留余量

D1：每次成功只写 1 行 JSON；保留 90 天原始 + 一年每日代表点。见 [数据模型](data-model.md#保留策略)。

接近上限时请看 Workers CPU、D1 写入、Queue 操作和（若开启）Browser Rendering 次数。

## 日志

Worker 打到 Cloudflare 日志的结构化对象，例如：

- `request`：method、path、status、durationMs
- `upstream_auth_failed`：host、status、有限的 error code、cf-ray
- `kimi_browser_fallback` / `_completed` / `_failed`
- `github_oauth_failed`：stage，不含 token
- `request_failed`：path 与 `error.name`，不含堆栈里的密钥

没有把上游响应体或凭据写入这些日志。
