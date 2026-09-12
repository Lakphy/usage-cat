import { GithubLogo, ShieldCheck } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ error: z.string().optional() }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const { error } = Route.useSearch();
  return (
    <div className="mx-auto max-w-md py-10">
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{t("Unable to sign in", "无法登录")}</AlertTitle>
          <AlertDescription>
            {error === "forbidden"
              ? t(
                  "This GitHub account is not on the administrator ID allowlist.",
                  "当前 GitHub 账号不在管理员 ID 白名单中。",
                )
              : t(
                  "GitHub authorization failed or expired. Please try again.",
                  "GitHub 授权失败或已过期，请重试。",
                )}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <span className="mb-4 grid size-10 place-items-center bg-foreground text-background">
            <ShieldCheck size={20} />
          </span>
          <CardTitle>{t("Administrator sign-in", "管理员登录")}</CardTitle>
          <CardDescription>
            {t(
              "The public dashboard requires no sign-in. An administrator session is only needed to configure credentials and trigger syncs.",
              "公开看板不需要登录；只有配置凭据和触发同步需要管理员会话。",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a href="/api/v1/auth/github" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            <GithubLogo data-icon="inline-start" weight="fill" />{" "}
            {t("Continue with GitHub", "使用 GitHub 登录")}
          </a>
          <p className="text-[10px] leading-5 text-muted-foreground">
            {t(
              "Only your public GitHub identity and numeric user ID are read. No repository permissions are requested, and the GitHub access token is discarded immediately after verification.",
              "仅读取 GitHub 公共身份并核对数字用户 ID，不申请仓库权限。GitHub Access Token 会在核验后立即丢弃。",
            )}
          </p>
          <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}>
            {t("Back to public dashboard", "返回公开看板")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
