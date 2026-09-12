# Usage Cat 文档

Usage Cat 是一个部署在 Cloudflare Workers 上的个人 AI 订阅用量看板。公开页面无需登录；管理后台用 GitHub 数字用户 ID 白名单保护。每次成功同步都向 D1 **追加**一条快照，即使数值没变也不会覆盖旧记录。

本目录只提供 Markdown，不依赖站点生成器。按 [Diátaxis](https://diataxis.fr/) 分成四类：先跟着教程把系统跑起来，再按任务查指南，查细节时打开参考，想理解设计时读说明。

## 我该读哪篇

| 你想… | 去读 |
| --- | --- |
| 在本机把项目跑起来并登录后台 | [本地入门](getting-started.md) |
| 部署到自己的 Cloudflare 账号 | [部署](deploy.md) |
| 改环境变量、密钥、`wrangler.jsonc` | [配置参考](configuration.md) |
| 使用公开看板和管理后台 | [使用说明](usage.md) |
| 接入某个平台的凭据与指标 | [适配器与凭据](adapters.md) |
| 看系统怎么串起来 | [架构说明](architecture.md) |
| 查表结构、快照 JSON、保留策略 | [数据模型](data-model.md) |
| 调用 HTTP API | [API 参考](api.md) |
| 了解加密、公开数据范围、上游协议风险 | [安全](security.md) |
| 查同步、队列、Cron、免费套餐预算 | [运行与配额](operations.md) |
| 改代码、跑测试、加适配器 | [开发](development.md) |
| 用 macOS 状态栏看公开用量 | [菜单栏客户端](../client/macos/README.md) |

仓库根目录的 [README](../README.md) 是短摘要；细节以本目录为准。

## 当前支持的平台

| 平台 | 稳定性 | 采集对象 |
| --- | --- | --- |
| Codex | Beta / 内部接口 | ChatGPT Codex 用量窗口与 Credits |
| Cursor | Beta / 内部接口 | Spending 页的模型额度与 Grok Bot 周额度 |
| Grok | Beta / 内部接口 | Grok Build 套餐 Credits 与按量 |
| ZenMux Subscription | 官方接口 | 5 小时 / 7 天 Flow 与月度上限 |
| Kimi Code | Beta | 会员额度窗口与 Booster |
| Kimi 开放平台余额 | 官方接口 | 可用 / 代金券 / 现金余额（中国区 CNY，海外区 USD） |

Beta 适配器依赖上游客户端的未文档化或会改版的接口。上游字段无法识别时会记 `UPSTREAM_SCHEMA_CHANGED`，**不会写入空快照**。风险说明见 [安全](security.md#上游接口与使用条款)。

## 约定

- 时间戳除非另有说明，都是 **Unix 秒**（不是毫秒）。
- 代码里的标识符（路由、环境变量、错误码、指标 `key`）保持原文，不翻译。
- 本仓库 `wrangler.jsonc` 里的域名和 D1 ID 是维护者自己的生产配置，**不是密钥**；你部署时仍必须改成自己的资源。
