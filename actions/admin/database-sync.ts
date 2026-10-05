"use server";

import { requireRole } from "@/lib/auth";
import { SCOPED_MERGE_ONLY } from "@/lib/database-sync/scope-policy";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { STAGING_ORIGIN } from "@/lib/deployment/staging-origin";
import { inspectDatabaseSync } from "@/lib/database-sync/preflight";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prepareDatabaseSync, applyDatabaseSync, restoreDatabaseSync, listDatabaseSyncRuns, DatabaseSyncError, type DatabaseSyncRun } from "@/lib/database-sync/worker";

export type PublicDatabaseSyncRun = Pick<DatabaseSyncRun, "id" | "mode" | "status" | "createdAt" | "expiresAt" | "counts" | "blockers" | "archivedListings" | "archivedDealers" | "reconciled" | "kind" | "restoreAvailable" | "backupExpiresAt" | "backupState" | "restoredFromId">;

const modeSchema = z.enum(["merge", "replace", "reset"]);
const applySchema = z.object({ runId: z.string().uuid(), confirmation: z.string() });
const confirmations = { merge: "MERGE INTO DEVELOPMENT", replace: "REPLACE DEVELOPMENT", reset: "RESET DEVELOPMENT", restore: "RESTORE DEVELOPMENT" } as const;
const disabled = "Database changes are available only on the staging deployment.";
const failed = "The database operation could not be completed. Refresh the inspection and prepare a new plan.";

function operationFailure(operation: "prepare" | "apply" | "restore", error: unknown): string {
  if (error instanceof DatabaseSyncError) return error.message;
  console.error("Database sync operation failed.", { operation });
  return failed;
}

function publicRun(run: DatabaseSyncRun): PublicDatabaseSyncRun {
  return {
    id: run.id, mode: run.mode, status: run.status, createdAt: run.createdAt, expiresAt: run.expiresAt,
    counts: run.counts, blockers: run.blockers, archivedListings: run.archivedListings, archivedDealers: run.archivedDealers, reconciled: run.reconciled,
    kind: run.kind, restoreAvailable: run.restoreAvailable, backupExpiresAt: run.backupExpiresAt, backupState: run.backupState, restoredFromId: run.restoredFromId,
  };
}

async function hasMutationOrigin() {
  const origin = (await headers()).get("origin");
  if (!origin) return false;
  if (process.env.VERCEL_ENV === "preview") return origin === STAGING_ORIGIN;
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL_ENV || process.env.ITRADER_LOCAL_STAGING_FEATURES !== "1") return false;
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
    return ["http:", "https:"].includes(configured.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) && origin === configured.origin;
  } catch { return false; }
}

export async function loadDatabaseSyncPreflight() {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) {
    return { error: "Database inspection is available only on the staging deployment." };
  }
  try { return { data: await inspectDatabaseSync() }; }
  catch { return { error: "Database inspection could not be completed. Try again shortly." }; }
}

export async function loadDatabaseSyncRuns() {
  await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: disabled };
  try { return { data: (await listDatabaseSyncRuns()).map(publicRun) }; }
  catch (error) { return { error: error instanceof DatabaseSyncError ? error.message : "Database history is unavailable. Refresh the page to try again." }; }
}

export async function prepareDatabaseSyncAction(input: unknown) {
  const admin = await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: disabled };
  if (!await hasMutationOrigin()) return { error: "Open this page on staging and try again." };
  const parsed = modeSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose Replace, Merge, or Reset." };
  try { return { data: publicRun(await prepareDatabaseSync(parsed.data, admin.id)) }; }
  catch (error) { return { error: operationFailure("prepare", error) }; }
}

export async function applyDatabaseSyncAction(input: unknown) {
  const admin = await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: disabled };
  if (!await hasMutationOrigin()) return { error: "Open this page on staging and try again." };
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { error: "The plan or confirmation is invalid." };
  try {
    const run = (await listDatabaseSyncRuns()).find((item) => item.id === parsed.data.runId);
    if (!run || run.status !== "prepared" || parsed.data.confirmation !== confirmations[run.mode]) {
      return { error: "Type the confirmation exactly as shown for the prepared plan." };
    }
    const result = await applyDatabaseSync(run.id, admin.id);
    revalidatePath("/admin/database");
    revalidatePath("/", "layout");
    return { data: publicRun(result) };
  } catch (error) { return { error: operationFailure("apply", error) }; }
}

export async function restoreDatabaseSyncAction(input: unknown) {
  const admin = await requireRole("ADMIN");
  if (!isStagingOnlyFeatureEnabled()) return { error: disabled };
  if (!await hasMutationOrigin()) return { error: "Open this page on staging and try again." };
  const parsed = applySchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== confirmations.restore) return { error: "Type the confirmation exactly as shown for the backup." };
  try {
    const run = (await listDatabaseSyncRuns()).find((item) => item.id === parsed.data.runId);
    if (!run?.restoreAvailable) return { error: SCOPED_MERGE_ONLY };
    const result = await restoreDatabaseSync(run.id, admin.id);
    revalidatePath("/admin/database");
    revalidatePath("/", "layout");
    return { data: publicRun(result) };
  } catch (error) { return { error: operationFailure("restore", error) }; }
}
