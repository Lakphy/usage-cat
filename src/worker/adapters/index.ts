import type { KimiCredentialMode, ProviderId } from "@/shared/usage";
import { codexAdapter } from "@/worker/adapters/codex";
import { cursorAdapter } from "@/worker/adapters/cursor";
import { grokAdapter } from "@/worker/adapters/grok";
import { kimiAdapter } from "@/worker/adapters/kimi";
import type { StoredCredential, UsageAdapter } from "@/worker/adapters/types";
import { zenmuxAdapter } from "@/worker/adapters/zenmux";
import { AdapterError } from "@/worker/errors";

export const adapters = {
  codex: codexAdapter,
  cursor: cursorAdapter,
  grok: grokAdapter,
  zenmux: zenmuxAdapter,
  kimi: kimiAdapter,
} satisfies Record<ProviderId, UsageAdapter<any>>;

function parseJsonFile(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AdapterError("INVALID_CREDENTIAL", `${label} 不是有效的 JSON`, false, true);
  }
}

function findNestedRecord(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  const pending: unknown[] = [value];
  let inspected = 0;
  while (pending.length > 0 && inspected < 2048) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== "object") continue;
    inspected += 1;
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (predicate(record)) return record;
    pending.push(...Object.values(record));
  }
  return undefined;
}

function findAuthRecord(value: unknown): Record<string, unknown> | undefined {
  return findNestedRecord(value, (record) => {
    const access = record.access_token ?? record.accessToken;
    const refresh = record.refresh_token ?? record.refreshToken;
    return typeof access === "string" && typeof refresh === "string";
  });
}

function findGrokAuthRecord(value: unknown): Record<string, unknown> | undefined {
  return findNestedRecord(value, (record) => {
    const access = record.key ?? record.access_token ?? record.accessToken;
    const userId = record.user_id ?? record.userId;
    return (
      typeof access === "string" && Boolean(access) && typeof userId === "string" && Boolean(userId)
    );
  });
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric))
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }
  return undefined;
}

function epochField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  const numeric = numberField(record, ...keys);
  if (numeric !== undefined) return numeric;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

export function normalizeCredential(
  provider: ProviderId,
  raw: string,
  credentialMode?: KimiCredentialMode,
): StoredCredential {
  const credential = raw.trim();
  if (["cursor", "zenmux", "kimi"].includes(provider) && credential.length > 4096) {
    throw new AdapterError("INVALID_CREDENTIAL", "API Key 长度异常", false, true);
  }
  if (provider === "cursor") {
    if (!credential.startsWith("crsr_"))
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "Cursor User API Key 应以 crsr_ 开头",
        false,
        true,
      );
    return { provider, apiKey: credential };
  }
  if (provider === "zenmux") {
    if (credential.startsWith("sk-ss-v1-") || credential.startsWith("sk-ai-v1-")) {
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        `${credential.startsWith("sk-ss-v1-") ? "sk-ss-v1- 订阅推理 Key" : "sk-ai-v1- PAYG 推理 Key"} 不能查询账户用量；请在 ZenMux Management 页面创建 sk-mg-v1- 管理 Key`,
        false,
        true,
      );
    }
    if (!credential.startsWith("sk-mg-v1-"))
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "ZenMux 用量查询需要以 sk-mg-v1- 开头的 Management API Key",
        false,
        true,
      );
    return { provider, apiKey: credential };
  }
  if (provider === "kimi") {
    const mode = credentialMode ?? "code_cn";
    if (mode.startsWith("code_") && !credential.startsWith("sk-kimi-"))
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "Kimi Code API Key 应以 sk-kimi- 开头；开放平台 Key 请切换账户类型",
        false,
        true,
      );
    if (mode.startsWith("platform_") && !credential.startsWith("sk-"))
      throw new AdapterError("INVALID_CREDENTIAL", "Kimi 开放平台 API Key 格式不正确", false, true);
    if (mode.startsWith("platform_") && credential.startsWith("sk-kimi-"))
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "sk-kimi- 是 Kimi Code Key；请切换到 Kimi Code 对应区域",
        false,
        true,
      );
    return { provider, apiKey: credential, mode };
  }

  const json = parseJsonFile(
    credential,
    provider === "codex" ? "Codex auth.json" : "Grok auth.json",
  );

  if (provider === "codex") {
    const auth = findAuthRecord(json);
    if (!auth) {
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "Codex auth.json 中没有找到 access_token 和 refresh_token",
        false,
        true,
      );
    }
    const accessToken = stringField(auth, "access_token", "accessToken");
    const refreshToken = stringField(auth, "refresh_token", "refreshToken");
    if (!accessToken || !refreshToken) {
      throw new AdapterError(
        "INVALID_CREDENTIAL",
        "Codex auth.json 缺少 access_token 或 refresh_token",
        false,
        true,
      );
    }
    const outer = json as Record<string, unknown>;
    const tokens =
      typeof outer.tokens === "object" && outer.tokens
        ? (outer.tokens as Record<string, unknown>)
        : auth;
    const accountId =
      stringField(tokens, "account_id", "accountId") ??
      stringField(auth, "account_id", "accountId");
    if (!accountId)
      throw new AdapterError("INVALID_CREDENTIAL", "Codex auth.json 缺少 account_id", false, true);
    return {
      provider,
      accessToken,
      refreshToken,
      idToken:
        stringField(auth, "id_token", "idToken") ?? stringField(tokens, "id_token", "idToken"),
      accountId,
      expiresAt: epochField(auth, "expires_at", "expiresAt"),
    };
  }

  const auth = findGrokAuthRecord(json);
  if (!auth) {
    throw new AdapterError(
      "INVALID_CREDENTIAL",
      "Grok auth.json 中没有找到 key 和 user_id",
      false,
      true,
    );
  }
  const accessToken = stringField(auth, "key", "access_token", "accessToken");
  const userId = stringField(auth, "user_id", "userId");
  if (!accessToken || !userId) {
    throw new AdapterError("INVALID_CREDENTIAL", "Grok auth.json 缺少 key 或 user_id", false, true);
  }
  const refreshToken = stringField(auth, "refresh_token", "refreshToken");
  const issuer = stringField(auth, "oidc_issuer", "issuer");
  const clientId = stringField(auth, "oidc_client_id", "client_id", "clientId");
  if (issuer && issuer !== "https://auth.x.ai") {
    throw new AdapterError("INVALID_CREDENTIAL", "只接受 x.ai 官方签发的 Grok 凭据", false, true);
  }
  if (refreshToken && (!issuer || !clientId)) {
    throw new AdapterError(
      "INVALID_CREDENTIAL",
      "Grok 可刷新凭据缺少 oidc_issuer 或 oidc_client_id",
      false,
      true,
    );
  }
  const firstName = stringField(auth, "first_name", "firstName");
  const lastName = stringField(auth, "last_name", "lastName");
  return {
    provider,
    accessToken,
    refreshToken,
    expiresAt: epochField(auth, "expires_at", "expiresAt"),
    issuer: issuer as "https://auth.x.ai" | undefined,
    clientId,
    userId,
    email: stringField(auth, "email"),
    username: [firstName, lastName].filter(Boolean).join(" ") || undefined,
    principalType: stringField(auth, "principal_type", "principalType"),
    principalId: stringField(auth, "principal_id", "principalId"),
  };
}

export type { StoredCredential } from "@/worker/adapters/types";
