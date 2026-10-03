import { z } from "zod";
import { getSetting } from "@/lib/config/site-settings";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";

export const DATABASE_SYNC_VISIBILITY_KEY = "database_sync_marketplace_visibility";
const ids = z.array(z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)).max(50_000);
const visibilitySchema = z.object({
  archivedListingIds: ids,
  archivedDealerIds: ids,
  visibleDealerIds: ids,
}).strict();
export type DatabaseSyncVisibility = z.infer<typeof visibilitySchema>;
export const EMPTY_DATABASE_SYNC_VISIBILITY: DatabaseSyncVisibility = {
  archivedListingIds: [], archivedDealerIds: [], visibleDealerIds: [],
};

export function parseDatabaseSyncVisibility(value: unknown): DatabaseSyncVisibility {
  const parsed = visibilitySchema.safeParse(value);
  if (!parsed.success) throw new Error("The staging marketplace visibility registry is invalid. Review the database sync settings.");
  return parsed.data;
}

/** Production never reads or applies the development-only visibility registry. */
export async function getDatabaseSyncVisibility(): Promise<DatabaseSyncVisibility | undefined> {
  if (!isStagingOnlyFeatureEnabled()) return undefined;
  return parseDatabaseSyncVisibility(await getSetting<unknown>(DATABASE_SYNC_VISIBILITY_KEY, EMPTY_DATABASE_SYNC_VISIBILITY));
}
