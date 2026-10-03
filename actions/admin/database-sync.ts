"use server";

import { requireRole } from "@/lib/auth";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { inspectDatabaseSync } from "@/lib/database-sync/preflight";

export async function loadDatabaseSyncPreflight() {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) {
    return { error: "Database inspection is available only on the staging deployment." };
  }
  return { data: await inspectDatabaseSync() };
}
