# 开发

给要改这个仓库的人。产品行为以其它文档为准；这里只写怎么开发、测试和扩展。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装，包管理器锁定 pnpm 10.28.0 |
| `pnpm dev` | Vite + Cloudflare 插件，本地 Worker/D1/前端 |
| `pnpm build` | `tsc -b && vite build` |
| `pnpm preview` | 预览构建结果 |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm test` | jsdom 单测 + Workers 集成测 |
| `pnpm test:watch` | 只监视 jsdom 那套 |
| `pnpm cf-typegen` | 生成 `src/worker/env.d.ts`（该文件 gitignore） |
| `pnpm db:migrate:local` / `:remote` | 应用 D1 迁移 |
| `pnpm run deploy` | build + `wrangler deploy` |

质量检查在本地跑：`pnpm lint && pnpm typecheck && pnpm test && pnpm build`。仓库没有 GitHub Actions。

## 目录

```
src/
  routes/                 # TanStack Router 页面
  components/             # 看板、凭据说明、shadcn UI
  lib/                    # 浏览器 API 客户端、图表、i18n、格式化
  shared/                 # 前后端共用类型与 schema
  worker/
    index.ts              # fetch / scheduled / queue
    auth.ts / admin-routes.ts / public-routes.ts
    sync.ts / crypto.ts / errors.ts / limits.ts
    adapters/             # 一个文件一个平台
migrations/               # 只追加，不改已经发布的 SQL
tests/
  fixtures/               # 上游响应契约样本
  unit/                   # jsdom
  worker/                 # Miniflare + D1
scripts/test-kimi-key.sh  # 交互诊断，不落盘
client/macos/             # 原生菜单栏客户端（Swift / SwiftUI）
```

`src/routeTree.gen.ts` 由路由插件生成，Biome 忽略它。

## 测试

两套 Vitest：

1. `vitest.config.ts`：`tests/unit/**`，jsdom，setup 为 `tests/setup.ts`。覆盖适配器解析、凭据裁剪、图表断点、加密、i18n。
2. `vitest.worker.config.ts`：`tests/worker/**`，`@cloudflare/vitest-pool-workers`，使用 `wrangler.jsonc` 的 D1 binding。覆盖公开访问、快照追加、租约、凭据刷新、归档。

适配器单测 mock `fetch` 和 `@cloudflare/puppeteer`，不打真实上游。

跑全部：

```bash
pnpm test
```

改适配器时的固定顺序：

1. 用官方客户端或诊断脚本拿到**脱敏**的新响应，替换 `tests/fixtures/<provider>-*.json`
2. 改解析器，升 `source.adapterVersion`
3. 补/改 `tests/unit/adapters.test.ts`
4. `pnpm lint && pnpm typecheck && pnpm test`

不要把真实 token、邮箱、账号 id 写进 fixture。现有样本是合成数字。

## 新增或修改适配器

1. 在 `src/shared/usage.ts` 的 `providerIds` / `providerMeta` 注册（若是新产品）。
2. `src/worker/adapters/types.ts` 增加 `StoredCredential` 分支。
3. 实现 `UsageAdapter`：`collect` 必须返回通过 `snapshotPayloadSchema` 的对象；需要刷新时实现 `prepareCredential`。
4. 在 `normalizeCredential` 里做格式校验和字段裁剪。拒绝未知主机。
5. `src/worker/adapters/index.ts` 登记到 `adapters`。
6. 管理后台表单、`credential-guide.tsx`、英文指标标签（`src/lib/format.ts` 的 `englishMetricLabels`）一起改。
7. SQL `CHECK (provider IN (…))` 若新增平台，**追加新迁移**，不要改 0001。
8. 迁移 `integrations` 时注意免费套餐 TRIGGER 仍然按 `interval_minutes` 计算。

解析原则：不要做跨平台的猜测型字段映射。认不出就 `UPSTREAM_SCHEMA_CHANGED`，不要写全 0 的假快照。Cursor On-Demand 未启用时不输出 0 值指标，是同一原则。

## i18n

没有独立文案表。组件里 `t("English", "中文")`。默认 locale 是 `en`。Cookie `usage_cat_locale`。Worker 在 HTML 里注入 `window.__USAGE_CAT_LOCALE__`。

指标：库里 `label` 以中文为主；英文界面用 `metricLabel()` 查 key 或替换「小时窗口」这类后缀。新 `key` 请同时加英文表。

错误：Worker 返回中文 `message` + 稳定 `code`；英文 UI 只翻译已知 `code`。

## 加密与测试密钥

单测使用 `btoa("0123456789abcdef0123456789abcdef")` 这类固定 32 字节密钥。不要把它配进生产。

更换生产 `CREDENTIAL_ENCRYPTION_KEY` 会使所有 `credential_secrets` 解密失败；测试里覆盖的是「换 key_version 避免 in-flight 刷新覆盖新凭据」，不是轮换主密钥。

## 代码风格

Biome `recommended`。`noExplicitAny` 关闭（适配器联合类型）。`src/components/ui/**` 对 shadcn 生成代码放宽了几条 a11y/security 规则，不要把业务组件放到那个目录来逃避 lint。

## 许可证

MIT，见仓库 [LICENSE](../LICENSE)。依赖以 MIT / Apache-2.0 / BSD / ISC 为主；JetBrains Mono 为 OFL-1.1，随 `@fontsource-variable/jetbrains-mono` 分发。
