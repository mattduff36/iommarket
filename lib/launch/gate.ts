import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";
import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Production and local runtimes stay gated until 10:00 BST on 3 October 2026.
 * PRODUCTION_LAUNCH_ENABLED exactly "1" opens them sooner.
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
  now = Date.now(),
): boolean {
  if (env.VERCEL_ENV === "preview") {
    return env[PREVIEW_LAUNCH_GATE_QA_FLAG] === PRODUCTION_LAUNCH_ENABLED_VALUE;
  }
  if (isProductionLaunchEnabled(env)) return false;
  return now < PUBLIC_LAUNCH_AT;
}

export function isCataloguePubliclyVisible(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  return !shouldEnforceLaunchGate(env, now);
}
