import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialGuide } from "@/components/credential-guide";
import { I18nProvider } from "@/lib/i18n";
import type { ProviderId } from "@/shared/usage";

afterEach(cleanup);

describe("凭据配置说明", () => {
  function guideNode(provider: ProviderId, kimiMode?: "code_cn" | "platform_global") {
    return (
      <I18nProvider initialLocale="zh-CN">
        <CredentialGuide provider={provider} kimiMode={kimiMode} />
      </I18nProvider>
    );
  }

  it.each([
    ["codex", "如何取得 Codex auth.json", "~/.usage-cat-codex/auth.json"],
    ["cursor", "如何取得 Cursor User API Key", "crsr_"],
    ["grok", "如何取得 Grok auth.json", "~/.usage-cat-grok/auth.json"],
    ["zenmux", "如何取得 ZenMux Management API Key", "sk-mg-v1-"],
  ] as const)("%s 显示凭据来源和关键格式", (provider, title, expectedText) => {
    render(guideNode(provider as ProviderId));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByText((text) => text.includes(expectedText)).length).toBeGreaterThan(0);
  });

  it("Codex 明确说明 auth.json 文件名和隐藏文件打开方式", () => {
    render(guideNode("codex"));
    const guide = screen.getByRole("region", { name: "如何取得 Codex auth.json" });
    expect(guide).toHaveTextContent("不是 os.json");
    expect(guide).toHaveTextContent("⌘⇧G");
    expect(guide).toHaveTextContent("系统钥匙串");
  });

  it("Cursor 说明实际采集的 Spending 额度与未启用按量付费语义", () => {
    render(guideNode("cursor"));
    const guide = screen.getByRole("region", { name: "如何取得 Cursor User API Key" });
    expect(guide).toHaveTextContent("Cursor Models");
    expect(guide).toHaveTextContent("Other Models");
    expect(guide).toHaveTextContent("Grok Bot 周额度");
    expect(guide).toHaveTextContent("未启用 On-Demand");
  });

  it("Kimi 说明随产品与区域切换", () => {
    const { rerender } = render(guideNode("kimi", "code_cn"));
    expect(screen.getByText((text) => text.includes("api.kimi.com"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kimi Code 中国区控制台/ })).toHaveAttribute(
      "href",
      "https://www.kimi.com/code/console",
    );

    rerender(guideNode("kimi", "platform_global"));
    expect(screen.getByText((text) => text.includes("api.moonshot.ai"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kimi API Platform 海外区 API Keys/ })).toHaveAttribute(
      "href",
      "https://platform.kimi.ai/console/api-keys",
    );
  });

  it("英文模式显示完整英文配置说明", () => {
    render(
      <I18nProvider initialLocale="en">
        <CredentialGuide provider="cursor" />
      </I18nProvider>,
    );
    const guideRegion = screen.getByRole("region", { name: "How to get a Cursor User API Key" });
    expect(guideRegion).toHaveTextContent("Open Cursor Dashboard");
    expect(guideRegion).toHaveTextContent("When On-Demand is disabled");
  });
});
