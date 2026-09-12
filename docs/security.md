# 安全

本文说明 Usage Cat **实际做了什么**，以及开源/自托管时你需要接受的风险。它不是渗透测试报告。

## 凭据如何存放

管理后台提交的 API Key 或 `auth.json` 不会原样落库。

1. `normalizeCredential` 只抽出同步需要的字段（token、account id、user id 等），丢掉文件里的其它内容。
2. `encryptCredential` 使用 AES-256-GCM。
3. AAD（附加认证数据）为 `<integrationId>:<provider>:<keyVersion>`。换监控项、平台或版本后，旧密文不能被解开。
4. IV 每条 12 字节随机 nonce，与密文一起存。
5. `CREDENTIAL_ENCRYPTION_KEY` 只在 Worker Secret / `.dev.vars`，必须是 32 字节的 Base64。

GitHub OAuth 的 `state` + PKCE verifier 用同一把密钥加密，AAD 为 `github-oauth-state:v1`，放在 HttpOnly Cookie 里，10 分钟过期。

丢失加密密钥等于丢失所有已存凭据。不要直接 `secret put` 一把新密钥覆盖生产；先在后台重新录入。

## 管理员鉴权

- GitHub OAuth + PKCE（S256）。
- 不申请 `repo` 等 scope；只读 `GET https://api.github.com/user` 的数字 `id`、`login`、`avatar_url`。
- 白名单是 **数字 ID**。改用户名不影响授权；换 GitHub 账号则要改 `ADMIN_GITHUB_IDS`。
- GitHub access token 核验后丢弃。
- 会话 token 随机 32 字节，库中仅 SHA-256；Cookie HttpOnly、SameSite=Lax、HTTPS 下 Secure、7 天。
- 用户被移出白名单后，下一次管理请求会删会话并 401。
- 写 API 校验 `Origin === APP_URL` 的 origin，降低跨站发 JSON 的风险。

头像 URL 允许出现在 CSP 的 `img-src`（`https://avatars.githubusercontent.com`）。

## 公开面暴露什么

产品默认是 **公开看板**。下列内容对未登录访问者可见：

- 显示名称、平台、套餐、启用状态、刷新周期
- `public_identity`（邮箱或用户名）
- 全部用量指标和时间序列
- `GET .../snapshots` 的完整 payload，含 `identity.email`

**不会**出现在公开 API 的：API Key、access/refresh token、加密凭据、GitHub 会话。

如果你不想让邮箱出现在公网，不要把站点暴露到公网，或改代码不再把 `identity.email` 写入 `public_identity` / 快照公开接口。当前实现没有「私密模式」开关。

## 出站请求约束

适配器不能让管理员指定 URL：

- 主机写死在各适配器常量里
- `redirect: manual`，拒绝跟随 3xx（防 SSRF 跳转到内网）
- 10 秒超时、1 MB 响应上限
- 错误日志只保留状态码、经过白名单的 OAuth error code、host、可选 `cf-ray`；Kimi 浏览器错误还会打码 URL 和 `sk-` 串

同步失败写入 `error_message` 时截断到 300 字符。

## HTTP 安全头

- Worker `/api/*`：`secureHeaders`（CSP `default-src 'none'`、HSTS、`Referrer-Policy: same-origin`）
- 静态页 `public/_headers`：`X-Frame-Options: DENY`、`nosniff`、禁相机/麦克风/地理位置、CSP 仅 `self` + 内联脚本/样式（前端主题引导脚本需要 `'unsafe-inline'`）+ GitHub 头像

## 前端注意

- 管理页用 `react-hook-form` + 共享 Zod schema，但真正的凭据规则在 Worker 的 `normalizeCredential`。
- 不要把 `.dev.vars`、`auth.json`、User API Key 提交进 git。`.gitignore` 已覆盖 `.dev.vars`、`.env*`、`.wrangler`。

## 上游接口与使用条款

源码版权是 MIT，**不授予**你使用 OpenAI、Cursor、xAI、Moonshot、ZenMux 服务的额外权利。各适配器风险不同：

| 适配器 | 条款层面 |
| --- | --- |
| ZenMux、Kimi 开放平台余额 | 官方、带文档的 API |
| Grok | 协议来自官方 Apache-2.0 客户端源码，用你自己的 `auth.json` |
| Kimi Code | 官方 CLI 同源的 `/usages`；Browser Rendering 绕过 Cloudflare challenge 更灰 |
| Codex | ChatGPT 未文档化的 `backend-api/wham/usage`，并复用官方 CLI 的公开 OAuth client id。OpenAI ToS 限制 reverse engineer 与 programmatic extract |
| Cursor | 个人用量没有官方 API；走 `api2.cursor.sh` Dashboard RPC。Cursor AUP 限制 reverse engineer、机器人访问 |

本项目只读用量、不转发推理、不转售额度。这降低了「代理盘」类滥用的相似度，但 **不能**当成上游授权。自托管者要自己遵守各平台条款；账号被限制是可能的。

Kimi 的 Browser 回退使用 Cloudflare Browser Rendering 去拉已被 challenge 的上游。这是可选路径，失败会熔断。若你不能接受「绕过反机器人保护」，应关掉 Browser binding 或删掉该分支（实现见 `src/worker/adapters/kimi.ts`）。

## 漏洞披露

这个服务替人保存 refresh token 和 API Key。若发现可导致凭据解密、会话劫持或 SSRF 的问题，请不要在公开 issue 里贴 poc 和密钥；联系维护者或开非公开报告。
