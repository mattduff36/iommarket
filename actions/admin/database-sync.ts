"use server";

import { requireRole } from "@/lib/auth";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { inspectDatabaseSync } from "@/lib/database-sync/preflight";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prepareDatabaseSync, applyDatabaseSync, listDatabaseSyncRuns, DatabaseSyncError, type DatabaseSyncRun } from "@/lib/database-sync/worker";
import { SYNC_TABLES, type SyncTableCounts } from "@/lib/database-sync/types";

export type PublicDatabaseSyncRun = Pick<DatabaseSyncRun, "id" | "mode" | "status" | "createdAt" | "expiresAt" | "counts" | "blockers" | "archivedListings" | "archivedDealers">;

const modeSchema = z.enum(["merge", "replace", "reset"]);
const applySchema = z.object({ runId: z.string().uuid(), confirmation: z.string() });
const confirmations = { merge: "MERGE INTO DEVELOPMENT", replace: "REPLACE DEVELOPMENT", reset: "RESET DEVELOPMENT" } as const;
const disabled = "Database changes are available only on the staging deployment.";
const failed = "The database operation could not be completed. Refresh the inspection and prepare a new plan.";

function publicRun(run: DatabaseSyncRun): PublicDatabaseSyncRun {
  const counts = Object.fromEntries(SYNC_TABLES.map((table) => [table, {
    insert: run.counts[table].insert, update: run.counts[table].update,
    delete: run.counts[table].delete, preserve: run.counts[table].preserve, skip: run.counts[table].skip,
  }])) as SyncTableCounts;
  return { id: run.id, mode: run.mode, status: run.status, createdAt: run.createdAt, expiresAt: run.expiresAt, counts, blockers: run.blockers, archivedListings: run.archivedListings, archivedDealers: run.archivedDealers };
}

async function hasMutationOrigin() {
  const origin = (await headers()).get("origin");
  if (!origin) return false;
  if (process.env.VERCEL_ENV === "preview") return origin === "https://staging.itrader.im";
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
  catch (error) { return { error: error instanceof DatabaseSyncError ? error.message : failed }; }
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
  } catch (error) { return { error: error instanceof DatabaseSyncError ? error.message : failed }; }
}
