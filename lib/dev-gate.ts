/**
 * Holding-page password gate. Preview deployments skip it; production and
 * local runtimes keep it.
 */
export function shouldEnforceDevGate(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VERCEL_ENV !== "preview";
}
