# API 参考

所有 API 前缀 `/api/v1`。JSON 请求与响应。出错时：

```json
{ "error": { "code": "UNAUTHORIZED", "message": "请先登录" } }
```

`message` 多为中文；英文 UI 按 `code` 映射，见 `src/lib/i18n.tsx` 的 `englishErrors`。

## 公共约定

- 写操作（`POST` / `PATCH` / `PUT` / `DELETE`）若带 `Origin` 头，必须等于 `APP_URL` 的 origin，否则 `403 INVALID_ORIGIN`。无 `Origin` 的请求（如同 origin 导航、curl）放行。
- `/api/*` 设置 `X-Robots-Tag: noindex`、CSP `default-src 'none'`、HSTS（配置了 https 时由 `secureHeaders` 发出）。
- 时间均为 Unix 秒。
- 管理接口依赖 Cookie `usage_cat_session`，需 `credentials: same-origin`。

## 健康检查

### `GET /api/v1/health`

无需鉴权。

```json
{ "ok": true }
```

---

## 鉴权

### `GET /api/v1/auth/github`

开始 GitHub OAuth。设置加密 Cookie `usage_cat_oauth`（10 分钟），重定向到 GitHub。参数：`client_id`、`redirect_uri`、`state`、`code_challenge`、`code_challenge_method=S256`。不传 `scope`。

### `GET /api/v1/auth/github/callback`

GitHub 回调。校验 state 与 PKCE，换 token，读 `/user`，核对该数字 ID 是否在 `ADMIN_GITHUB_IDS`。

- 成功：种下 `usage_cat_session`，重定向 `/admin`
- 非白名单：`/login?error=forbidden`
- 其它失败：`/login?error=github`

GitHub access token 不入库。

### `POST /api/v1/auth/logout`

需要管理员。删除会话 hash，清空 Cookie。`{ "ok": true }`。

---

## 公开接口

无需登录。响应可被 CDN 缓存（见各接口 Cache-Control）。

### `GET /api/v1/public/dashboard`

未归档监控项，按 `sort_order`、`created_at`、`id`。每条带最新一条快照解析出的 `metrics`。解析失败则 `metrics` 为空数组。

```json
{
  "data": [
    {
      "id": "…",
      "provider": "kimi",
      "displayName": "Kimi 主账号",
      "publicIdentity": "user@example.com",
      "plan": "Kimi Code（中国区）",
      "status": "healthy",
      "enabled": true,
      "intervalMinutes": 15,
      "lastSyncedAt": 1700000000,
      "metrics": []
    }
  ],
  "generatedAt": 1700000000
}
```

`Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=120`

`publicIdentity` 来自快照的 `identity.email`，否则 `identity.username`。公开页面会显示它。

### `GET /api/v1/public/integrations/:id/history`

查询参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `metric` | 必填，最长 100 | 指标 `key` |
| `from` | `now - 7d` | 起（秒） |
| `to` | `now` | 止；上限 `now + 300` |
| `sampling` | 非 `envelope` 则只取每桶最新 | `envelope` 时每桶额外保留峰值行 |

`from` 不会早于 `to - 365 天`。跨度 ≤ 7 天：`bucketSeconds = 1`（原始点）。更长：`max(60, ceil(span / 600))`，约最多 600 桶。

归档或不存在的 id → `404 NOT_FOUND`。缺 `metric` → `400 BAD_REQUEST`。

```json
{
  "data": [{ "capturedAt": 1700000000, "metric": { "key": "kimi-weekly", "kind": "quota_window" } }],
  "metric": "kimi-weekly",
  "from": 1699395200,
  "to": 1700000000,
  "bucketSeconds": 1
}
```

`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`

### `GET /api/v1/public/integrations/:id/snapshots`

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | 30 | 1–100 |
| `cursor` | 第一页 | URL-safe Base64（JSON `[captured_at, id]`）；旧版纯数字 cursor 仍可用 |

按 `captured_at DESC, id DESC`。响应含完整 `payload`（包括 `identity`），以及 `nextCursor`。

---

## 管理接口

均需 `requireAdmin`。未登录或会话失效、用户被移出白名单 → `401 UNAUTHORIZED`。列表接口 `Cache-Control: no-store`。

### `GET /api/v1/admin/session`

```json
{
  "data": {
    "githubUserId": "12345678",
    "githubLogin": "octocat",
    "githubAvatarUrl": "https://avatars.githubusercontent.com/…",
    "expiresAt": 1700000000
  }
}
```

### `GET /api/v1/admin/integrations`

`data` 为监控项数组（含 `hasCredential`、`sortOrder`、`nextSyncAt`、`lastErrorCode`），以及：

```json
{
  "limits": {
    "enabled": 10,
    "scheduledSyncsPerDay": 1000,
    "scheduledSyncsPerDayUsed": 96
  }
}
```

`scheduledSyncsPerDayUsed` 是 `ceil(Σ 1440 / interval_minutes)`。

### `POST /api/v1/admin/integrations`

```json
{
  "provider": "kimi",
  "displayName": "Kimi 主账号",
  "intervalMinutes": 15,
  "enabled": true,
  "credential": "sk-kimi-…",
  "credentialMode": "code_cn"
}
```

`credentialMode` 仅 Kimi 需要。`201`：`{ "data": { "id", "runId" } }`，并入队 `verify`。

失败：

- `400` + `INVALID_CREDENTIAL`：格式/前缀/区域不匹配
- `409 LIMIT_REACHED`：启用数已达 10
- `409 SYNC_BUDGET_EXCEEDED`：计划同步将超过每天 1000

### `PATCH /api/v1/admin/integrations/:id`

任意子集：`displayName`、`intervalMinutes`、`enabled`、`credential`、`credentialMode`。带 `credential` 时会换 `key_version` 并 `verify`。`404` 若已归档。

### `DELETE /api/v1/admin/integrations/:id`

归档。`{ "ok": true, "retainedSnapshotsDays": 365 }`。凭据立即删除。

### `POST /api/v1/admin/integrations/reorder`

```json
{ "orderedIds": ["id-1", "id-2"] }
```

必须正好是当前未归档集合的一个排列，否则 `409 ORDER_STALE`。顺序未变则直接 `{ "ok": true }`。写入的 `sort_order` 为 `(index + 1) * 100`。

### `POST /api/v1/admin/integrations/:id/sync`

手动同步。`202 { "data": { "runId" } }`。30 秒内重复 → `429 RATE_LIMITED`。

### `GET /api/v1/admin/sync-runs`

最近 100 条，含 `display_name`、`trigger_type`、`status`、`attempt`、`error_code`、`error_message`。

---

## 错误码

| `code` | 典型 HTTP | 可重试 | 需人工 | 含义 |
| --- | --- | --- | --- | --- |
| `AUTH_EXPIRED` | 同步失败 | 否 | 是 | 凭据失效或 OAuth 刷新被拒 |
| `INVALID_CREDENTIAL` | 400 | 否 | 是 | 录入格式不对 |
| `RATE_LIMITED` | 429 或同步失败 | 是 | 否 | 上游或手动同步限流 |
| `UPSTREAM_UNAVAILABLE` | 同步失败 | 是 | 否 | 超时、5xx、业务暂不可用 |
| `UPSTREAM_SCHEMA_CHANGED` | 同步失败 | 否 | 是 | 无法解析或非 JSON / 非法重定向 |
| `NETWORK_ERROR` | 同步失败 | 是 | 否 | 连不上上游 |
| `BROWSER_FALLBACK_FAILED` | 同步失败 | 否 | 否 | Kimi 浏览器回退失败，随后熔断 1 小时 |
| `BROWSER_FALLBACK_COOLDOWN` | 同步失败 | 否 | 否 | 熔断期内 |
| `LIMIT_REACHED` | 409 | — | — | 启用监控项过多 |
| `SYNC_BUDGET_EXCEEDED` | 409 | — | — | 计划同步超每天 1000 |
| `ORDER_STALE` | 409 | — | — | 排序时列表已变 |
| `UNAUTHORIZED` | 401 | — | — | 未登录或白名单已变 |
| `INVALID_ORIGIN` | 403 | — | — | Origin 与 `APP_URL` 不符 |
| `NOT_FOUND` | 404 | — | — | 监控项或路由不存在 |
| `BAD_REQUEST` | 400 | — | — | 缺参数 |
| `MISSING_CONFIG` | 同步失败 | 否 | 是 | run 对应的监控项或凭据没了 |
| `INTERNAL_ERROR` | 500 | — | — | 未捕获异常；日志只记 path 和 error.name |
