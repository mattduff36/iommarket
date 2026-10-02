import type { RuntimeEnv } from "@/lib/runtime-env";

/**
 * Public launch instant. Preview does not use this gate, so the same code
 * can stay on preview while production opens at 10:00 BST.
 */
export const PUBLIC_LAUNCH_AT = Date.parse("2026-10-03T10:00:00+01:00");

export function launchWelcomeEnvironment(env: RuntimeEnv = process.env): string {
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return env.VERCEL_ENV;
  return "local";
}

export function holdingCountdownTarget(
  env: RuntimeEnv = process.env,
): { opensAt: number; releaseOnZero: boolean } {
  return {
    opensAt: PUBLIC_LAUNCH_AT,
    releaseOnZero: env.VERCEL_ENV !== "preview",
  };
}
