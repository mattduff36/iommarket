import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Holding-page password gate. Vercel Preview skips it. Production stays
 * gated unless the explicit launch flag is enabled. Local runtimes stay gated.
 */
export function shouldEnforceDevGate(
  env: RuntimeEnv = process.env,
): boolean {
  return shouldEnforceLaunchGate(env);
}
