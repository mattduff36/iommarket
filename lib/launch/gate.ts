import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Production stays gated until PRODUCTION_LAUNCH_ENABLED is exactly "1".
 * Vercel Preview stays open. Missing or malformed configuration fails closed.
 */
export const PRODUCTION_LAUNCH_FLAG = "PRODUCTION_LAUNCH_ENABLED";
export const PRODUCTION_LAUNCH_ENABLED_VALUE = "1";

export function isProductionLaunchEnabled(
  env: RuntimeEnv = process.env,
): boolean {
  return env[PRODUCTION_LAUNCH_FLAG] === PRODUCTION_LAUNCH_ENABLED_VALUE;
}

export function shouldEnforceLaunchGate(
  env: RuntimeEnv = process.env,
): boolean {
  if (env.VERCEL_ENV === "preview") return false;
  if (isProductionLaunchEnabled(env)) return false;
  return true;
}

export function isCataloguePubliclyVisible(
  env: RuntimeEnv = process.env,
): boolean {
  return !shouldEnforceLaunchGate(env);
}
