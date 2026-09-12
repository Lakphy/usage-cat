import type { SyncMessage } from "@/shared/usage";

export interface Env {
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncMessage>;
  ASSETS: Fetcher;
  BROWSER?: Fetcher;
  APP_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ADMIN_GITHUB_IDS: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
}

export interface AdminSession {
  githubUserId: string;
  githubLogin: string;
  githubAvatarUrl?: string;
  expiresAt: number;
}

export type AppVariables = {
  session: AdminSession;
};
