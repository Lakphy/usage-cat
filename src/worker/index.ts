import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { SyncMessage } from "@/shared/usage";
import { adminRoutes } from "@/worker/admin-routes";
import { serveAppAsset } from "@/worker/app-document";
import { beginGithubLogin, finishGithubLogin, logout, requireAdmin } from "@/worker/auth";
import type { AppVariables, Env } from "@/worker/env";
import { publicRoutes } from "@/worker/public-routes";
import { cleanupExpiredData, consumeSyncQueue, scheduleDueIntegrations } from "@/worker/sync";

export const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

export function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const scheduledAt = Math.floor(controller.scheduledTime / 1000);
  return controller.cron === "17 19 * * *"
    ? cleanupExpiredData(env, scheduledAt)
    : scheduleDueIntegrations(env, scheduledAt);
}

app.use("/api/*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  console.info("request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
  });
});
app.use(
  "/api/*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "same-origin",
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("X-Robots-Tag", "noindex");
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.env.APP_URL).origin) {
      return c.json({ error: { code: "INVALID_ORIGIN", message: "请求来源无效" } }, 403);
    }
  }
  await next();
});

app.get("/api/v1/health", (c) => c.json({ ok: true }));
app.get("/api/v1/auth/github", beginGithubLogin);
app.get("/api/v1/auth/github/callback", finishGithubLogin);
app.post("/api/v1/auth/logout", requireAdmin, logout);
app.route("/api/v1/public", publicRoutes);
app.route("/api/v1/admin", adminRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "NOT_FOUND", message: "接口不存在" } }, 404);
  }
  return serveAppAsset(c.req.raw, c.env.ASSETS);
});

app.onError((error, c) => {
  console.error("request_failed", { path: c.req.path, name: error.name });
  return c.json({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } }, 500);
});

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return app.fetch(request, env, context);
  },
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(handleScheduled(controller, env));
  },
  queue(batch: MessageBatch<SyncMessage>, env: Env, context: ExecutionContext) {
    context.waitUntil(consumeSyncQueue(batch, env));
  },
} satisfies ExportedHandler<Env, SyncMessage>;
