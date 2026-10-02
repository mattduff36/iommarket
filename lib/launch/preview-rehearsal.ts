import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Temporary rehearsal on the preview branch only.
 * Production stays gated until PRODUCTION_LAUNCH_ENABLED is exactly "1".
 */
export const PREVIEW_REHEARSAL_BRANCH = "preview";
export const PREVIEW_GATE_OPENS_AT = Date.parse("2026-10-02T22:15:00+01:00");
export const PUBLIC_LAUNCH_AT = Date.parse("2026-10-03T10:00:00+01:00");

export function isPreviewRehearsalBranch(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === PREVIEW_REHEARSAL_BRANCH;
}

export function previewRehearsalStillClosed(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  return isPreviewRehearsalBranch(env) && now < PREVIEW_GATE_OPENS_AT;
}

export function holdingCountdownTarget(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): { opensAt: number; releaseOnZero: boolean } {
  if (previewRehearsalStillClosed(env, now)) {
    return { opensAt: PREVIEW_GATE_OPENS_AT, releaseOnZero: true };
  }
  return { opensAt: PUBLIC_LAUNCH_AT, releaseOnZero: false };
}
