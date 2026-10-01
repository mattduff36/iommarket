import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";

export function canSendEarlyAccessBulk(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" && shouldEnforceLaunchGate(env);
}

export function canSendEarlyAccessTest(env: RuntimeEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") return shouldEnforceLaunchGate(env);
  return true;
}

export function sanitizeEarlyAccessError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Early access failed.";
  return message.replace(/token|proof|nonce|password|bearer/gi, "[redacted]").slice(0, 300);
}
