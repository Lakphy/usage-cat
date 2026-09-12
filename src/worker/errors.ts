import { ZodError } from "zod";

export type AdapterErrorCode =
  | "AUTH_EXPIRED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_SCHEMA_CHANGED"
  | "INVALID_CREDENTIAL"
  | "NETWORK_ERROR"
  | "BROWSER_FALLBACK_FAILED"
  | "BROWSER_FALLBACK_COOLDOWN";

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly actionRequired = false,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function safeError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  if (error instanceof ZodError) {
    return new AdapterError(
      "UPSTREAM_SCHEMA_CHANGED",
      "上游响应结构已变化，请升级适配器",
      false,
      true,
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AdapterError("NETWORK_ERROR", "上游请求超时", true);
  }
  return new AdapterError("NETWORK_ERROR", "无法连接上游服务", true);
}
