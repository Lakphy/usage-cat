import { Cat, Check, GithubLogo, Moon, Sun, Translate } from "@phosphor-icons/react";
import { Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function initialDark() {
  if (typeof window === "undefined") return false;
  const saved = localStorage.getItem("usage-cat-theme");
  return saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const [dark, setDark] = useState(initialDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("usage-cat-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid size-7 place-items-center bg-foreground text-background">
              <Cat weight="fill" className="size-4" />
            </span>
            USAGE CAT
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <Link
              to="/"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "hidden sm:inline-flex",
              )}
            >
              {t("Dashboard", "公开看板")}
            </Link>
            <Link to="/admin" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              <GithubLogo data-icon="inline-start" />
              {t("Admin", "管理")}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                aria-label={t("Change language", "切换语言")}
              >
                <Translate data-icon="inline-start" />
                <span className="hidden sm:inline">{locale === "en" ? "EN" : "中文"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => setLocale("en")}>
                  <span>English</span>
                  {locale === "en" ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale("zh-CN")}>
                  <span>简体中文</span>
                  {locale === "zh-CN" ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              onClick={() => setDark((value) => !value)}
              aria-label={t("Toggle color theme", "切换明暗主题")}
            >
              {dark ? <Sun /> : <Moon />}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl border-t px-4 py-6 text-[11px] text-muted-foreground sm:px-6">
        {t("Snapshots retained for 365 days", "快照保留 365 天")} · Powered by Cloudflare
      </footer>
    </div>
  );
}
