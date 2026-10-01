/** Server-side feature gate for the optional admin checklist. */
export function isAdminChecklistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ADMIN_CHECKLIST_ENABLED === "1") return true;
  if (env.ADMIN_CHECKLIST_ENABLED === "0") return false;
  return env.VERCEL_ENV === "preview";
}

export const ADMIN_CHECKLIST_DISABLED_ERROR = "Admin checklist is disabled.";
