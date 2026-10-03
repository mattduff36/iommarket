import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

/** The checklist has one canonical writer: the staging database. */
export function isAdminChecklistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ADMIN_CHECKLIST_ENABLED === "0") return false;
  return isStagingOnlyFeatureEnabled(env);
}

export const ADMIN_CHECKLIST_DISABLED_ERROR = "Admin checklist is disabled.";
