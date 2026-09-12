import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { decryptCredential, encryptCredential, randomToken, sha256 } from "@/worker/crypto";
import type { AppVariables, Env } from "@/worker/env";

const SESSION_COOKIE = "usage_cat_session";
const OAUTH_COOKIE = "usage_cat_oauth";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;
const OAUTH_AAD = "github-oauth-state:v1";

interface OAuthState {
  state: string;
  verifier: string;
  expiresAt: number;
}

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
}

const SAFE_OAUTH_ERRORS = new Set([
  "bad_verification_code",
  "incorrect_client_credentials",
  "redirect_uri_mismatch",
  "unverified_user_email",
]);

function logOauthFailure(stage: string, status?: number, upstreamError?: string) {
  console.warn("github_oauth_failed", {
    stage,
    status,
    upstreamError:
      upstreamError && SAFE_OAUTH_ERRORS.has(upstreamError) ? upstreamError : undefined,
  });
}

function callbackUrl(env: Env): string {
  return new URL("/api/v1/auth/github/callback", env.APP_URL).toString();
}

function cookieOptions(env: Env, maxAge = SESSION_SECONDS) {
  return {
    httpOnly: true,
    secure: new URL(env.APP_URL).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

function allowedGithubIds(env: Env): Set<string> {
  return new Set(
    env.ADMIN_GITHUB_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

async function githubJson<T>(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; data: T } | undefined> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      console.warn("github_request_redirect_rejected", {
        target: new URL(url).hostname,
        status: response.status,
      });
      return undefined;
    }
    const text = await response.text();
    if (text.length > 100_000) return undefined;
    return { response, data: JSON.parse(text) as T };
  } catch (error) {
    console.warn("github_request_failed", {
      target: new URL(url).hostname,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 160) : undefined,
    });
    return undefined;
  }
}

export async function beginGithubLogin(c: Context<{ Bindings: Env }>) {
  const state = randomToken();
  const verifier = randomToken(64);
  const challenge = await sha256(verifier);
  const now = Math.floor(Date.now() / 1000);
  const sealed = await encryptCredential(
    { state, verifier, expiresAt: now + OAUTH_SECONDS },
    c.env.CREDENTIAL_ENCRYPTION_KEY,
    OAUTH_AAD,
  );
  setCookie(c, OAUTH_COOKIE, `${sealed.nonce}.${sealed.encryptedPayload}`, {
    ...cookieOptions(c.env, OAUTH_SECONDS),
    sameSite: "Lax",
  });
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callbackUrl(c.env));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return c.redirect(authorize.toString());
}

export async function finishGithubLogin(c: Context<{ Bindings: Env }>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const failure = () => c.redirect("/login?error=github");
  const stateCookie = getCookie(c, OAUTH_COOKIE);
  setCookie(c, OAUTH_COOKIE, "", cookieOptions(c.env, 0));
  if (!code || !state || !stateCookie) {
    logOauthFailure("missing_callback_state");
    return failure();
  }
  const now = Math.floor(Date.now() / 1000);
  const separator = stateCookie.indexOf(".");
  if (separator <= 0) {
    logOauthFailure("invalid_state_cookie");
    return failure();
  }
  let saved: OAuthState;
  try {
    saved = await decryptCredential<OAuthState>(
      stateCookie.slice(separator + 1),
      stateCookie.slice(0, separator),
      c.env.CREDENTIAL_ENCRYPTION_KEY,
      OAUTH_AAD,
    );
  } catch {
    logOauthFailure("state_decryption");
    return failure();
  }
  if (
    saved.state !== state ||
    typeof saved.verifier !== "string" ||
    saved.verifier.length < 43 ||
    !Number.isSafeInteger(saved.expiresAt) ||
    saved.expiresAt < now
  ) {
    logOauthFailure("state_validation");
    return failure();
  }

  const tokenResult = await githubJson<GithubTokenResponse>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(c.env),
        code_verifier: saved.verifier,
      }),
    },
  );
  if (!tokenResult?.response.ok || !tokenResult.data.access_token) {
    logOauthFailure("token_exchange", tokenResult?.response.status, tokenResult?.data.error);
    return failure();
  }

  const userResult = await githubJson<{ id?: number; login?: string; avatar_url?: string }>(
    "https://api.github.com/user",
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${tokenResult.data.access_token}`,
        "user-agent": "usage-cat-cloudflare-worker",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  const user = userResult?.data;
  if (!userResult?.response.ok || !user?.id || !user.login) {
    logOauthFailure("user_identity", userResult?.response.status);
    return failure();
  }
  if (!allowedGithubIds(c.env).has(String(user.id))) {
    console.warn("github_oauth_forbidden", { githubUserId: String(user.id) });
    return c.redirect("/login?error=forbidden");
  }

  const token = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions
      (token_hash, github_user_id, github_login, github_avatar_url, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256(token),
      String(user.id),
      user.login,
      user.avatar_url ?? null,
      now + SESSION_SECONDS,
      now,
    )
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c.env));
  return c.redirect("/admin");
}

export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, 401);
    const now = Math.floor(Date.now() / 1000);
    const row = await c.env.DB.prepare(
      `SELECT github_user_id, github_login, github_avatar_url, expires_at
     FROM admin_sessions WHERE token_hash = ? AND expires_at > ?`,
    )
      .bind(await sha256(token), now)
      .first<{
        github_user_id: string;
        github_login: string;
        github_avatar_url: string | null;
        expires_at: number;
      }>();
    if (!row || !allowedGithubIds(c.env).has(row.github_user_id)) {
      if (row) {
        await c.env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
          .bind(await sha256(token))
          .run();
      }
      setCookie(c, SESSION_COOKIE, "", cookieOptions(c.env, 0));
      return c.json({ error: { code: "UNAUTHORIZED", message: "登录已失效" } }, 401);
    }
    c.set("session", {
      githubUserId: row.github_user_id,
      githubLogin: row.github_login,
      githubAvatarUrl: row.github_avatar_url ?? undefined,
      expiresAt: row.expires_at,
    });
    await next();
  },
);

export async function logout(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token)
    await c.env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  setCookie(c, SESSION_COOKIE, "", cookieOptions(c.env, 0));
  return c.json({ ok: true });
}
