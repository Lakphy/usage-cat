import { type Locale, localeDescription, localeFromCookie } from "@/shared/locale";

const HTML_LANGUAGE_PATTERN = /(<html\b[^>]*\blang=")[^"]*(")/i;
const HTML_DATA_LOCALE_PATTERN = /(<html\b[^>]*\bdata-usage-cat-locale=")[^"]*(")/i;
const DESCRIPTION_PATTERN = /(<meta\b[^>]*\bname="description"[^>]*\bcontent=")[^"]*("[^>]*>)/i;
const INITIAL_LOCALE_PATTERN = /window\.__USAGE_CAT_LOCALE__\s*=\s*"[^"]*";/;

export function localizeAppDocument(html: string, locale: Locale): string {
  return html
    .replace(HTML_LANGUAGE_PATTERN, `$1${locale}$2`)
    .replace(HTML_DATA_LOCALE_PATTERN, `$1${locale}$2`)
    .replace(DESCRIPTION_PATTERN, `$1${localeDescription(locale)}$2`)
    .replace(INITIAL_LOCALE_PATTERN, `window.__USAGE_CAT_LOCALE__ = "${locale}";`);
}

function isDocumentRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  if (request.headers.get("accept")?.includes("text/html")) return true;
  const segment = new URL(request.url).pathname.split("/").at(-1) ?? "";
  return !segment.includes(".");
}

export async function serveAppAsset(request: Request, assets: Fetcher): Promise<Response> {
  if (!isDocumentRequest(request)) return assets.fetch(request);

  const locale = localeFromCookie(request.headers.get("cookie"));
  // The asset binding's SPA fallback resolves route URLs to index.html. Requesting /index.html
  // directly triggers Cloudflare's canonical redirect to / and would loop through the Worker.
  // Strip validators because the same underlying asset ETag is shared by both localized variants.
  const assetRequestHeaders = new Headers(request.headers);
  assetRequestHeaders.delete("if-modified-since");
  assetRequestHeaders.delete("if-none-match");
  const assetResponse = await assets.fetch(new Request(request, { headers: assetRequestHeaders }));
  const headers = new Headers(assetResponse.headers);
  headers.set("Content-Language", locale);
  headers.set("Cache-Control", "private, no-store");
  headers.append("Vary", "Cookie");
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Last-Modified");

  if (request.method === "HEAD" || !assetResponse.ok) {
    return new Response(null, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  }

  const html = localizeAppDocument(await assetResponse.text(), locale);
  return new Response(html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}
