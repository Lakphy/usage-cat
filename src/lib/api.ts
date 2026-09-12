import type {
  HistoryPoint,
  KimiCredentialMode,
  ProviderId,
  PublicIntegration,
} from "@/shared/usage";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? "Request failed", response.status, body.error?.code);
  }
  return body as T;
}

export const apiClient = {
  dashboard: () =>
    api<{ data: PublicIntegration[]; generatedAt: number }>("/api/v1/public/dashboard"),
  history: (
    id: string,
    metric: string,
    from: number,
    to: number,
    sampling: "latest" | "envelope" = "latest",
  ) =>
    api<{ data: HistoryPoint[]; bucketSeconds: number }>(
      `/api/v1/public/integrations/${encodeURIComponent(id)}/history?metric=${encodeURIComponent(metric)}&from=${from}&to=${to}&sampling=${sampling}`,
    ),
  snapshots: (id: string, limit = 30) =>
    api<{
      data: Array<{
        id: string;
        capturedAt: number;
        payload: { metrics: HistoryPoint["metric"][] };
      }>;
    }>(`/api/v1/public/integrations/${encodeURIComponent(id)}/snapshots?limit=${limit}`),
  session: () =>
    api<{ data: { githubUserId: string; githubLogin: string; githubAvatarUrl?: string } }>(
      "/api/v1/admin/session",
    ),
  adminIntegrations: () => api<AdminIntegrationsResponse>("/api/v1/admin/integrations"),
  reorderIntegrations: (orderedIds: string[]) =>
    api<{ ok: true }>("/api/v1/admin/integrations/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    }),
  createIntegration: (body: CreateIntegrationInput) =>
    api<{ data: { id: string; runId: string } }>("/api/v1/admin/integrations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateIntegration: (id: string, body: Partial<Omit<CreateIntegrationInput, "provider">>) =>
    api<{ data: { id: string; runId?: string } }>(
      `/api/v1/admin/integrations/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  archiveIntegration: (id: string) =>
    api<{ ok: true }>(`/api/v1/admin/integrations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  syncIntegration: (id: string) =>
    api<{ data: { runId: string } }>(`/api/v1/admin/integrations/${encodeURIComponent(id)}/sync`, {
      method: "POST",
    }),
  syncRuns: () => api<{ data: SyncRun[] }>("/api/v1/admin/sync-runs"),
  logout: () => api<{ ok: true }>("/api/v1/auth/logout", { method: "POST" }),
};

export interface CreateIntegrationInput {
  provider: ProviderId;
  displayName: string;
  intervalMinutes: number;
  enabled: boolean;
  credential: string;
  credentialMode?: KimiCredentialMode;
}

export interface AdminLimits {
  enabled: number;
  scheduledSyncsPerDay: number;
  scheduledSyncsPerDayUsed: number;
}

export interface AdminIntegration {
  id: string;
  provider: ProviderId;
  displayName: string;
  publicIdentity?: string;
  plan?: string;
  status: "pending" | "healthy" | "action_required";
  enabled: boolean;
  intervalMinutes: number;
  nextSyncAt: number;
  lastSyncedAt?: number;
  lastErrorCode?: string;
  hasCredential: boolean;
  sortOrder: number;
}

export interface AdminIntegrationsResponse {
  data: AdminIntegration[];
  limits: AdminLimits;
}

export interface SyncRun {
  id: string;
  integration_id: string;
  display_name: string;
  trigger_type: "schedule" | "manual" | "verify";
  status: "queued" | "running" | "succeeded" | "failed";
  scheduled_at: number;
  started_at?: number;
  finished_at?: number;
  attempt: number;
  error_code?: string;
  error_message?: string;
}
