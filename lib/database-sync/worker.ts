import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { applyClone, prepareClone, restoreClone } from "./clone-engine";
import { inspectDatabaseSyncConfiguration } from "./preflight";
import { resolvePreviewSessionUrl } from "./session";
import { DatabaseSyncError } from "./snapshot";
import type { SyncActionCounts } from "./types";

export { DatabaseSyncError } from "./snapshot";
export type DatabaseSyncMode = "merge" | "replace" | "reset";
export type DatabaseSyncBackupState = "newest" | "retained" | "expired" | "none";
export type DatabaseSyncRun = {
  id: string;
  mode: DatabaseSyncMode;
  status: "prepared" | "applied";
  createdAt: string;
  expiresAt: string;
  counts: Record<string, SyncActionCounts>;
  blockers: string[];
  archivedListings: number;
  archivedDealers: number;
  reconciled: string[];
  kind: "sync" | "restore";
  restoreAvailable: boolean;
  backupExpiresAt: string | null;
  backupState: DatabaseSyncBackupState;
  restoredFromId: string | null;
};

type StoredRun = {
  id: string;
  mode: string;
  status: "prepared" | "applied";
  created_at: Date;
  expires_at: Date;
  summary: unknown;
  kind?: string | null;
  restored_from_id?: string | null;
  backup_bytes?: string | number | null;
  backup_expires_at?: Date | null;
  payload_pruned_at?: Date | null;
};

function assertStaging(env: NodeJS.ProcessEnv) {
  if (!isStagingOnlyFeatureEnabled(env)) throw new DatabaseSyncError("Database sync is available only on the verified staging database.");
  if (!inspectDatabaseSyncConfiguration(env).destination) throw new DatabaseSyncError("Development database identity could not be verified.");
  resolvePreviewSessionUrl(env);
}

function publicRun(row: StoredRun): DatabaseSyncRun {
  const summary = row.summary && typeof row.summary === "object"
    ? row.summary as { counts?: Record<string, SyncActionCounts>; blockers?: string[]; archivedListings?: number; archivedDealers?: number; reconciled?: string[] }
    : {};
  const expiresAt = row.backup_expires_at ? new Date(row.backup_expires_at).getTime() : null;
  const pruned = Boolean(row.payload_pruned_at);
  const bytes = Number(row.backup_bytes ?? 0);
  const backupState: DatabaseSyncBackupState = row.status !== "applied" || bytes <= 0
    ? (pruned ? "expired" : "none")
    : expiresAt == null ? "newest"
    : expiresAt > Date.now() ? "retained" : "expired";
  return {
    id: row.id,
    mode: row.mode === "merge" || row.mode === "reset" ? row.mode : "replace",
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    counts: summary.counts ?? {},
    blockers: summary.blockers ?? [],
    archivedListings: summary.archivedListings ?? 0,
    archivedDealers: summary.archivedDealers ?? 0,
    reconciled: summary.reconciled ?? [],
    kind: row.kind === "restore" ? "restore" : "sync",
    restoreAvailable: backupState === "newest" || backupState === "retained",
    backupExpiresAt: row.backup_expires_at ? new Date(row.backup_expires_at).toISOString() : null,
    backupState,
    restoredFromId: row.restored_from_id ?? null,
  };
}

export async function listDatabaseSyncRuns(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun[]> {
  assertStaging(env);
  const { inspectionPoolOptions } = await import("./preflight");
  const pg = (await import("pg")).default;
  const pool = new pg.Pool(inspectionPoolOptions(resolvePreviewSessionUrl(env), env));
  const client = await pool.connect();
  try {
    const { assertStoreReady } = await import("./store");
    await assertStoreReady(client);
    const result = await client.query<StoredRun>(`SELECT id, mode, status, created_at, expires_at, summary, kind, restored_from_id, backup_bytes::text, backup_expires_at, payload_pruned_at
      FROM staging_admin.database_sync_runs ORDER BY created_at DESC LIMIT 12`);
    return result.rows.map(publicRun);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function prepareDatabaseSync(mode: DatabaseSyncMode, actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun> {
  if (!["merge", "replace", "reset"].includes(mode)) throw new DatabaseSyncError("Unknown sync mode.");
  assertStaging(env);
  return publicRun(await prepareClone(mode, actorId, env));
}

export async function applyDatabaseSync(runId: string, actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new DatabaseSyncError("Invalid sync preview.");
  assertStaging(env);
  return publicRun(await applyClone(runId, actorId, env));
}

export async function restoreDatabaseSync(runId: string, actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new DatabaseSyncError("Invalid sync preview.");
  assertStaging(env);
  return publicRun(await restoreClone(runId, actorId, env));
}
