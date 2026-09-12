import { z } from "zod";

export const providerIds = ["codex", "cursor", "grok", "zenmux", "kimi"] as const;
export const providerSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerSchema>;

export const kimiCredentialModes = [
  "code_cn",
  "code_global",
  "platform_cn",
  "platform_global",
] as const;
export const kimiCredentialModeSchema = z.enum(kimiCredentialModes);
export type KimiCredentialMode = z.infer<typeof kimiCredentialModeSchema>;

export const providerMeta: Record<
  ProviderId,
  {
    name: string;
    credentialLabel: string;
    credentialKind: "api-key" | "auth-file";
    beta: boolean;
    defaultIntervalMinutes: number;
  }
> = {
  codex: {
    name: "Codex",
    credentialLabel: "Codex auth.json",
    credentialKind: "auth-file",
    beta: true,
    defaultIntervalMinutes: 15,
  },
  cursor: {
    name: "Cursor",
    credentialLabel: "User API Key",
    credentialKind: "api-key",
    beta: true,
    defaultIntervalMinutes: 60,
  },
  grok: {
    name: "Grok",
    credentialLabel: "Grok auth.json",
    credentialKind: "auth-file",
    beta: true,
    defaultIntervalMinutes: 60,
  },
  zenmux: {
    name: "ZenMux Subscription",
    credentialLabel: "Management API Key（sk-mg-v1-…）",
    credentialKind: "api-key",
    beta: false,
    defaultIntervalMinutes: 30,
  },
  kimi: {
    name: "Kimi",
    credentialLabel: "Kimi API Key",
    credentialKind: "api-key",
    beta: true,
    defaultIntervalMinutes: 15,
  },
};

export const metricKindSchema = z.enum(["quota_window", "billing_counter", "balance", "instant"]);

const finiteNumber = z.number().finite();

export const usageMetricSchema = z
  .object({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
    kind: metricKindSchema,
    unit: z.string().min(1).max(30),
    used: finiteNumber.optional(),
    limit: finiteNumber.optional(),
    remaining: finiteNumber.optional(),
    value: finiteNumber.optional(),
    percentage: finiteNumber.min(0).max(100).optional(),
    periodStart: z.number().int().optional(),
    periodEnd: z.number().int().optional(),
    resetAt: z.number().int().optional(),
  })
  .refine((value) => value.used !== undefined || value.value !== undefined, {
    message: "用量指标至少需要 used 或 value",
  });

export type UsageMetric = z.infer<typeof usageMetricSchema>;

export const snapshotPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: providerSchema,
    capturedAt: z.number().int(),
    identity: z.object({
      username: z.string().max(200).optional(),
      email: z.string().max(320).optional(),
    }),
    plan: z.string().max(200).optional(),
    metrics: z.array(usageMetricSchema).min(1),
    source: z.object({
      adapterVersion: z.string(),
    }),
  })
  .superRefine((value, context) => {
    const keys = new Set<string>();
    for (const [index, metric] of value.metrics.entries()) {
      if (keys.has(metric.key)) {
        context.addIssue({
          code: "custom",
          message: `指标 key 重复：${metric.key}`,
          path: ["metrics", index, "key"],
        });
      }
      keys.add(metric.key);
    }
  });

export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

export interface PublicIntegration {
  id: string;
  provider: ProviderId;
  displayName: string;
  publicIdentity?: string;
  plan?: string;
  status: "pending" | "healthy" | "action_required";
  enabled: boolean;
  intervalMinutes: number;
  lastSyncedAt?: number;
  metrics: UsageMetric[];
}

export interface HistoryPoint {
  capturedAt: number;
  metric: UsageMetric;
}

export interface SyncMessage {
  integrationId: string;
  runId: string;
}

export const integrationInputSchema = z.object({
  provider: providerSchema,
  displayName: z.string().trim().min(1).max(80),
  intervalMinutes: z.number().int().min(5).max(1440),
  enabled: z.boolean(),
  credential: z.string().min(1).max(128_000),
  credentialMode: kimiCredentialModeSchema.optional(),
});

export const integrationUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  intervalMinutes: z.number().int().min(5).max(1440).optional(),
  enabled: z.boolean().optional(),
  credential: z.string().min(1).max(128_000).optional(),
  credentialMode: kimiCredentialModeSchema.optional(),
});

export const integrationOrderSchema = z
  .object({
    orderedIds: z.array(z.string().min(1).max(100)).min(1).max(1_000),
  })
  .superRefine((value, context) => {
    if (new Set(value.orderedIds).size !== value.orderedIds.length) {
      context.addIssue({
        code: "custom",
        message: "排序列表不能包含重复的监控项",
        path: ["orderedIds"],
      });
    }
  });

export type IntegrationInput = z.infer<typeof integrationInputSchema>;
