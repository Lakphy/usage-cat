# 本地入门

这篇是教程：从零在本机跑起 Usage Cat，用 GitHub 登录后台，并加上第一个监控项。部署到 Cloudflare 见 [部署](deploy.md)。

## 你需要什么

- Node.js 22 或更高
- pnpm 10（仓库 `packageManager` 锁定为 `pnpm@10.28.0`）
- 一个 GitHub 账号，用来当管理员
- 至少一个平台的凭据（见 [适配器与凭据](adapters.md)）

## 1. 安装

```bash
git clone https://github.com/Lakphy/usage-cat.git
cd usage-cat
pnpm install
cp .dev.vars.example .dev.vars
```

## 2. 填写本地密钥

用编辑器打开 `.dev.vars`。四项都必须改成真实值，占位字符串不能登录、也不能加密凭据。

```bash
GITHUB_CLIENT_ID="github-oauth-client-id"
GITHUB_CLIENT_SECRET="github-oauth-client-secret"
ADMIN_GITHUB_IDS="12345678"
CREDENTIAL_ENCRYPTION_KEY="base64-encoded-32-byte-key"
```

生成加密密钥：

```bash
openssl rand -base64 32
```

`ADMIN_GITHUB_IDS` 是逗号分隔的 **GitHub 数字用户 ID**，不是用户名。打开 `https://api.github.com/users/<你的用户名>`，用返回 JSON 里的 `id` 字段。

`CREDENTIAL_ENCRYPTION_KEY` 必须是正好 32 字节随机值的 Base64。本地和线上应使用不同的密钥。

## 3. 创建 GitHub OAuth App

1. 打开 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App。
2. Application name 任意，例如 `usage-cat-local`。
3. Homepage URL 填 `http://localhost:5173`。
4. Authorization callback URL **必须精确**为：

```text
http://localhost:5173/api/v1/auth/github/callback
```

5. 创建后把 Client ID 和 Client Secret 写入 `.dev.vars`。
6. **不要**申请仓库或其他额外 scope。应用登录时不会带 `scope` 参数，只读取公开身份。

生产环境需要另建一个 OAuth App，回调改成 HTTPS 站点地址，见 [部署](deploy.md)。

## 4. 初始化本地 D1 并启动

```bash
pnpm db:migrate:local
pnpm dev
```

默认开发地址是 `http://localhost:5173`。Vite 通过 `@cloudflare/vite-plugin` 在同一进程里跑 Worker、D1 和前端。

## 5. 登录并添加监控项

1. 打开首页，确认公开看板能加载（此时还没有监控项，会看到空状态）。
2. 点「管理」，用 GitHub 登录。不在 `ADMIN_GITHUB_IDS` 里的账号会跳到 `/login?error=forbidden`。
3. 在后台选择平台、填写显示名称、刷新周期和凭据。创建成功后会立刻入队一次 `verify` 同步。
4. 回到公开看板，等同步成功后应能看到卡片。详情页在 `/providers/<id>`。

凭据只在管理后台提交。Codex / Grok 请上传隔离目录里生成的 `auth.json`，不要把文件提交进 git。逐步说明见 [适配器与凭据](adapters.md)。

## 6. 可选：跑一遍质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

下一步：把同一套代码 [部署到 Cloudflare](deploy.md)，或先读 [使用说明](usage.md)。
