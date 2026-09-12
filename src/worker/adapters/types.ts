import type { KimiCredentialMode, ProviderId, SnapshotPayload } from "@/shared/usage";

export type StoredCredential =
  | {
      provider: "codex";
      accessToken: string;
      refreshToken: string;
      idToken?: string;
      accountId: string;
      expiresAt?: number;
    }
  | {
      provider: "cursor";
      apiKey: string;
      accessToken?: string;
      accessTokenExpiresAt?: number;
    }
  | {
      provider: "grok";
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      issuer?: "https://auth.x.ai";
      clientId?: string;
      userId: string;
      email?: string;
      username?: string;
      principalType?: string;
      principalId?: string;
    }
  | { provider: "zenmux"; apiKey: string }
  | { provider: "kimi"; apiKey: string; mode?: KimiCredentialMode };

export interface CollectResult {
  snapshot: SnapshotPayload;
}

export interface AdapterContext {
  now: number;
  fetch: typeof fetch;
  browser?: Fetcher;
  browserFallbackDisabledUntil?: number;
  syncAttempt?: number;
  forceRefresh?: boolean;
}

export interface UsageAdapter<P extends ProviderId = ProviderId> {
  provider: P;
  prepareCredential?(
    credential: Extract<StoredCredential, { provider: P }>,
    context: AdapterContext,
  ): Promise<Extract<StoredCredential, { provider: P }>>;
  collect(
    credential: Extract<StoredCredential, { provider: P }>,
    context: AdapterContext,
  ): Promise<CollectResult>;
}
