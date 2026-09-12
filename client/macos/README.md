# Usage Cat 菜单栏客户端

原生 macOS 客户端，包含状态栏小程序和桌面小组件（Swift / SwiftUI / WidgetKit）。只读云端公开看板，填写一个地址即可拉取全部用量，不保存任何平台凭据。

要求 macOS 26+。构建需要 Xcode Command Line Tools；小组件的配置界面还需要完整 Xcode，构建脚本会从中取 `appintentsmetadataprocessor` 提取 App Intents 元数据（缺失时会打印 warning 并继续，但小组件将无法配置）。

```bash
cd client/macos
swift run UsageCatMenuCheck   # 纯逻辑校验（无 XCTest，见下）
./scripts/build.sh
open "dist/Usage Cat.app"
```

点状态栏图标打开面板。首次使用选「设置…」，填入站点地址，例如 `https://usage.example.com`，或完整接口 `https://usage.example.com/api/v1/public/dashboard`。之后每 5 分钟自动刷新。

桌面小组件支持小号和中号两种尺寸。右键小组件选「编辑小组件」，先选 AI 应用，再选要显示的一到两条用量；用量列表会跟随所选应用刷新。

## 结构

```
Sources/
  UsageCatMenuCore/   # 模型、看板接口、格式化、共享缓存、小组件选择解析
  UsageCatIntents/    # 小组件配置 Intent 与动态选项
  UsageCatMenu/       # 状态栏应用（NSStatusItem + 自绘面板 + 设置窗口）
  UsageCatWidget/     # WidgetKit 扩展
  UsageCatMenuCheck/  # 校验用可执行文件
scripts/build.sh      # 构建、提取 Intent 元数据、打包 .appex、ad-hoc 签名
```

应用与小组件通过 Application Support 下的共享文件交换看板快照；小组件沙盒只能读自己的容器，所以应用会把快照同时写进小组件容器。

## 开发约定

- **不要用 `@State` / `@FocusState`**：Command Line Tools 的 SwiftUI 宏会编译失败。`@StateObject`、`@Published`、`@EnvironmentObject`、`@main` 和 App Intents 的 `@Parameter` 可用。
- **不要在 Intent 类型上写含函数调用的计算属性**：`appintentsmetadataprocessor` 无法解析编译器为其生成的常量值，且会静默丢弃整个 Intent，导致小组件无法配置。
- 没有 XCTest / Swift Testing，纯逻辑断言都放在 `UsageCatMenuCheck` 里。
- 客户端界面一律英文（`Format.swift` 固定 `en-US`），服务端返回的中文指标名由映射表翻译。
- WidgetKit 会忽略同版本号的替换，`build.sh` 因此给每次构建打上时间戳版本；调试时可 `killall chronod` 重启小组件宿主。
