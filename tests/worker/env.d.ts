import "@cloudflare/vitest-pool-workers/types";
import type { Env as UsageCatEnv } from "@/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends UsageCatEnv {}
  }
}
