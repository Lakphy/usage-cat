import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  localeDescription,
  localeFromCookie,
  normalizeLocale,
} from "@/shared/locale";

declare global {
  interface Window {
    __USAGE_CAT_LOCALE__?: string;
  }
}

type Translate = (english: string, chinese: string) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function initialClientLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  if (window.__USAGE_CAT_LOCALE__) return normalizeLocale(window.__USAGE_CAT_LOCALE__);
  return localeFromCookie(document.cookie);
}

function persistLocale(locale: Locale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store is not supported by every target browser; synchronous persistence also prevents a navigation race.
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  window.__USAGE_CAT_LOCALE__ = locale;
  document.documentElement.lang = locale;
  document.documentElement.dataset.usageCatLocale = locale;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", localeDescription(locale));
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((nextLocale: Locale) => {
    persistLocale(nextLocale);
    updateLocale(nextLocale);
  }, []);
  const t = useCallback<Translate>(
    (english, chinese) => (locale === "zh-CN" ? chinese : english),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

const englishErrors: Record<string, string> = {
  AUTH_EXPIRED: "The credential has expired. Replace it and try again.",
  BAD_REQUEST: "The request is incomplete or invalid.",
  BROWSER_FALLBACK_COOLDOWN: "Browser fallback is cooling down. It will retry next cycle.",
  BROWSER_FALLBACK_FAILED: "The browser fallback could not reach the provider.",
  INTERNAL_ERROR: "The service is temporarily unavailable.",
  INVALID_CREDENTIAL: "The credential is invalid or does not match the selected product.",
  INVALID_ORIGIN: "The request origin is not allowed.",
  LIMIT_REACHED: "The maximum number of enabled monitors has been reached.",
  NETWORK_ERROR: "The provider could not be reached.",
  NOT_FOUND: "The requested monitor was not found.",
  ORDER_STALE: "The monitor list changed. Refresh and try ordering it again.",
  RATE_LIMITED: "The provider is rate limiting requests. Try again later.",
  SYNC_BUDGET_EXCEEDED:
    "The scheduled sync budget would be exceeded. Increase the refresh interval.",
  UNAUTHORIZED: "Please sign in with an authorized GitHub account.",
  UPSTREAM_SCHEMA_CHANGED: "The provider response format has changed and needs attention.",
  UPSTREAM_UNAVAILABLE: "The provider is temporarily unavailable.",
};

export function localizedErrorMessage(error: unknown, locale: Locale): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (locale === "en") {
    if (typeof candidate?.code === "string" && englishErrors[candidate.code]) {
      return englishErrors[candidate.code];
    }
    return "The request failed. Please try again.";
  }
  return typeof candidate?.message === "string" ? candidate.message : "操作失败，请重试。";
}
