/** Browser fragments are never sent to Cloudinary; this marker prevents cleanup from claiming source assets. */
export const DATABASE_SYNC_REFERENCE_FRAGMENT = "#itrader-database-sync-readonly";

export function markDatabaseSyncReference(url: string): string {
  return `${url.split("#", 1)[0]}${DATABASE_SYNC_REFERENCE_FRAGMENT}`;
}

export function isDatabaseSyncReference(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return new URL(url).hash === DATABASE_SYNC_REFERENCE_FRAGMENT; }
  catch { return false; }
}
