export const supportedLocales = ["en", "zh-CN"] as const;

export type Locale = (typeof supportedLocales)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "usage_cat_locale";

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "zh-CN" || value?.toLowerCase() === "zh-cn" ? "zh-CN" : DEFAULT_LOCALE;
}

export function localeFromCookie(cookieHeader: string | null | undefined): Locale {
  if (!cookieHeader) return DEFAULT_LOCALE;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      return normalizeLocale(decodeURIComponent(rawValue));
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  return DEFAULT_LOCALE;
}

export function localeDescription(locale: Locale): string {
  return locale === "zh-CN"
    ? "Usage Cat - 私有 AI 订阅用量监控"
    : "Usage Cat - Private AI subscription usage monitoring";
}
