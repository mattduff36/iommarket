"use server";

import type { DatabaseSyncRun } from "@/lib/database-sync/worker";
import type { DatabaseSyncInspection } from "@/lib/database-sync/preflight";

// Retained only so older, now-unused components remain type-compatible. The
// scoped merge interface has been retired in favour of the full preview mirror.
export type PublicDatabaseSyncRun = Pick<DatabaseSyncRun, "id" | "mode" | "status" | "createdAt" | "expiresAt" | "counts" | "blockers" | "archivedListings" | "archivedDealers" | "reconciled" | "kind" | "restoreAvailable" | "backupExpiresAt" | "backupState" | "restoredFromId">;

const retired = { error: "This database operation is no longer available. Use the preview refresh control." };

export async function loadDatabaseSyncPreflight(): Promise<{ error: string } | { data: DatabaseSyncInspection }> { return retired; }
export async function loadDatabaseSyncRuns(): Promise<{ error: string } | { data: PublicDatabaseSyncRun[] }> { return retired; }
export async function prepareDatabaseSyncAction(_input: unknown) { return retired; }
export async function applyDatabaseSyncAction(_input: unknown) { return retired; }
export async function restoreDatabaseSyncAction(_input: unknown) { return retired; }
