import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Holding-page gate. Vercel Preview skips it. Production and local runtimes
 * stay gated until 10:00 BST on 3 October 2026, unless the launch flag is exactly "1".
 */
export function shouldEnforceDevGate(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  return shouldEnforceLaunchGate(env, now);
}
