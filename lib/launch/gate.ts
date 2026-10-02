import { isPreviewRehearsalBranch, PREVIEW_GATE_OPENS_AT } from "@/lib/launch/preview-rehearsal";
import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Production stays gated until PRODUCTION_LAUNCH_ENABLED is exactly "1".
 * The preview branch stays gated until 22:15 BST on 2 October 2026, then opens.
 * Other Vercel Preview deployments stay open unless PREVIEW_LAUNCH_GATE_QA is exactly "1".
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
    if (isPreviewRehearsalBranch(env)) return now < PREVIEW_GATE_OPENS_AT;
    return env[PREVIEW_LAUNCH_GATE_QA_FLAG] === PRODUCTION_LAUNCH_ENABLED_VALUE;
  }
  if (isProductionLaunchEnabled(env)) return false;
  return true;
}

export function isCataloguePubliclyVisible(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  return !shouldEnforceLaunchGate(env, now);
}
