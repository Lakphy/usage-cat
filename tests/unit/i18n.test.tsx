import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { localeFromCookie } from "@/shared/locale";
import { localizeAppDocument, serveAppAsset } from "@/worker/app-document";

const documentTemplate = `<!doctype html>
<html lang="en" data-usage-cat-locale="en">
<head>
  <meta name="description" content="Usage Cat - Private AI subscription usage monitoring" />
  <script>window.__USAGE_CAT_LOCALE__ = "en";</script>
</head>
</html>`;

function LocaleControl() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button type="button" onClick={() => setLocale("zh-CN")}>
      {locale}:{t("English", "中文")}
    </button>
  );
}

describe("i18n locale selection", () => {
  it("defaults to English and only accepts the supported Chinese locale from Cookie", () => {
    expect(localeFromCookie(undefined)).toBe("en");
    expect(localeFromCookie("session=x; usage_cat_locale=zh-CN; theme=dark")).toBe("zh-CN");
    expect(localeFromCookie("usage_cat_locale=fr")).toBe("en");
    expect(localeFromCookie("usage_cat_locale=%E0%A4%A")).toBe("en");
  });

  it("localizes the edge-served document before the client starts", () => {
    const html = localizeAppDocument(documentTemplate, "zh-CN");
    expect(html).toContain('<html lang="zh-CN" data-usage-cat-locale="zh-CN">');
    expect(html).toContain("Usage Cat - 私有 AI 订阅用量监控");
    expect(html).toContain('window.__USAGE_CAT_LOCALE__ = "zh-CN";');
  });

  it("serves a Cookie-selected document without sharing validators across languages", async () => {
    const assets = {
      fetch: async (request: Request) => {
        expect(request.headers.has("if-none-match")).toBe(false);
        return new Response(documentTemplate, {
          headers: { "content-type": "text/html", etag: '"shared-asset"' },
        });
      },
    } as unknown as Fetcher;
    const response = await serveAppAsset(
      new Request("https://usage.example/admin", {
        headers: {
          accept: "text/html",
          cookie: "usage_cat_locale=zh-CN",
          "if-none-match": '"shared-asset"',
        },
      }),
      assets,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-language")).toBe("zh-CN");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("etag")).toBe(false);
    expect(await response.text()).toContain('<html lang="zh-CN"');
  });

  it("updates the UI, document language, and persistent Cookie together", () => {
    render(
      <I18nProvider initialLocale="en">
        <LocaleControl />
      </I18nProvider>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("en:English");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("zh-CN:中文");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.cookie).toContain("usage_cat_locale=zh-CN");
  });
});
