import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Production stays gated until PRODUCTION_LAUNCH_ENABLED is exactly "1".
 * Vercel Preview stays open unless PREVIEW_LAUNCH_GATE_QA is exactly "1".
 * Missing or malformed configuration fails closed.
 */
export const PRODUCTION_LAUNCH_FLAG = "PRODUCTION_LAUNCH_ENABLED";
export const PRODUCTION_LAUNCH_ENABLED_VALUE = "1";
export const PREVIEW_LAUNCH_GATE_QA_FLAG = "PREVIEW_LAUNCH_GATE_QA";

export function isProductionLaunchEnabled(
  env: RuntimeEnv = process.env,
): boolean {
  return env[PRODUCTION_LAUNCH_FLAG] === PRODUCTION_LAUNCH_ENABLED_VALUE;
}

export function shouldEnforceLaunchGate(
  env: RuntimeEnv = process.env,
): boolean {
  if (env.VERCEL_ENV === "preview") {
    return env[PREVIEW_LAUNCH_GATE_QA_FLAG] === PRODUCTION_LAUNCH_ENABLED_VALUE;
  }
  if (isProductionLaunchEnabled(env)) return false;
  return true;
}

export function isCataloguePubliclyVisible(
  env: RuntimeEnv = process.env,
): boolean {
  return !shouldEnforceLaunchGate(env);
}
