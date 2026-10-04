import { randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { inspectDatabaseSyncConfiguration, inspectionPoolOptions, inspectClient } from "./preflight";
import { planDatabaseSync } from "./planner";
import { executeOperations } from "./executor";
import { sanitiseSourceMedia } from "./media";
import { DATABASE_SYNC_VISIBILITY_KEY, EMPTY_DATABASE_SYNC_VISIBILITY, parseDatabaseSyncVisibility } from "./visibility";
import { assertStoreReady, seal, unseal, verifySealed } from "./store";
import { assertSnapshotSize, DatabaseSyncError, findBlockedDeletes, quote, readDataset, readProtection, stableHash, type ProtectionSnapshot } from "./snapshot";
import { SYNC_TABLES, type DatabaseSyncPlan, type SyncDataset, type BlockedDelete } from "./types";

export { DatabaseSyncError } from "./snapshot";
export type DatabaseSyncMode = "merge" | "replace" | "reset";
export type DatabaseSyncRun = {
  id: string;
  mode: DatabaseSyncMode;
  status: "prepared" | "applied";
  createdAt: string;
  expiresAt: string;
  counts: DatabaseSyncPlan["counts"];
  blockers: string[];
  archivedListings: number;
  archivedDealers: number;
};
type FrozenSnapshot = {
  plan: DatabaseSyncPlan;
  backup: SyncDataset;
  protection: ProtectionSnapshot;
  destinationHash: string;
  sourceCapturedAt: string;
  visibility?: { archivedListingIds: string[]; archivedDealerIds: string[]; visibleDealerIds: string[] };
};
type StoredRun = { id: string; actor_id: string; mode: DatabaseSyncMode; status: "prepared" | "applied"; created_at: Date; expires_at: Date; encrypted_snapshot: string; summary: Pick<DatabaseSyncPlan, "counts" | "blockers"> & { archivedListings?: number; archivedDealers?: number } };

function configuration(env: NodeJS.ProcessEnv) {
  if (!isStagingOnlyFeatureEnabled(env)) throw new DatabaseSyncError("Database sync is available only on the verified staging database.");
  const config = inspectDatabaseSyncConfiguration(env);
  if (!config.destination) throw new DatabaseSyncError("Development database identity could not be verified.");
  if (!/^[a-f0-9]{64}$/i.test(env.DATABASE_SYNC_ENCRYPTION_KEY ?? "")) throw new DatabaseSyncError("The staging backup encryption key is not configured.");
  return config as typeof config & { destination: string };
}

async function withDestination<T>(env: NodeJS.ProcessEnv, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const config = configuration(env);
  const pool = new pg.Pool(inspectionPoolOptions(config.destination, env));
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await assertStoreReady(client);
    return await callback(client);
  } finally {
    client?.release();
    await pool.end();
  }
}

function publicRun(row: StoredRun): DatabaseSyncRun {
  return { id: row.id, mode: row.mode, status: row.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), counts: row.summary.counts, blockers: row.summary.blockers, archivedListings: row.summary.archivedListings ?? 0, archivedDealers: row.summary.archivedDealers ?? 0 };
}

function selectedSignature(tables: { table_name: string; column_signature: string }[]) {
  return stableHash(tables.map((table) => [table.table_name, table.column_signature]));
}

async function sourceSnapshot(env: NodeJS.ProcessEnv) {
  const config = configuration(env);
  if (!config.source) throw new DatabaseSyncError("A dedicated production read-only connection is required.");
  const pool = new pg.Pool(inspectionPoolOptions(config.source, env));
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    const inspection = await inspectClient(client, true);
    const data = await readDataset(client, false, true);
    const visible = await client.query<{ id: string }>(`SELECT DISTINCT d.id FROM public."DealerProfile" d JOIN public."User" u ON u.id=d."userId"
      JOIN public."Subscription" s ON s."dealerId"=d.id WHERE d."isAdminPreview"=false AND u.role IN ('DEALER','ADMIN')
      AND u."disabledAt" IS NULL AND u."deletedAt" IS NULL AND s.status='ACTIVE' AND (
        (s.source='PAYMENT' AND s."currentPeriodEnd">now()) OR
        (s.source='ADMIN_GRANT' AND s."revokedAt" IS NULL AND s."grantStartsAt"<=now() AND s."grantEndsAt">now()))`);
    await client.query("COMMIT");
    const sourceImageOrigins = Object.fromEntries(data.ListingImage.map((row) => [String(row.id), { provider: String(row.provider) as "CLOUDINARY" | "EXTERNAL", publicId: String(row.publicId) }]));
    return { data: sanitiseSourceMedia(data, env), inspection, sourceImageOrigins, visibleDealerIds: visible.rows.map((row) => row.id) };
  } catch (error) {
    await client?.query("ROLLBACK");
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function requireActor(client: PoolClient, actorId: string) {
  const actor = await client.query(`SELECT id FROM public."User" WHERE id=$1 AND role='ADMIN' AND "disabledAt" IS NULL AND "deletedAt" IS NULL`, [actorId]);
  if (actor.rowCount !== 1) throw new DatabaseSyncError("An active development administrator is required.");
}

export async function listDatabaseSyncRuns(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun[]> {
  return withDestination(env, async (client) => {
    const result = await client.query<StoredRun>("SELECT id,mode,status,created_at,expires_at,summary FROM staging_admin.database_sync_runs ORDER BY created_at DESC LIMIT 12");
    return result.rows.map(publicRun);
  });
}

export async function prepareDatabaseSync(mode: DatabaseSyncMode, actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun> {
  if (!["merge", "replace", "reset"].includes(mode)) throw new DatabaseSyncError("Unknown sync mode.");
  configuration(env);
  const source = mode === "reset" ? null : await sourceSnapshot(env);
  return withDestination(env, async (client) => {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await client.query("SET LOCAL statement_timeout='30s'");
      await requireActor(client, actorId);
      const recent = await client.query<{ count: string }>("SELECT count(*) FROM staging_admin.database_sync_runs WHERE actor_id=$1 AND created_at > now()-interval '1 minute'", [actorId]);
      if (Number(recent.rows[0].count) >= 3) throw new DatabaseSyncError("Please wait a minute before preparing another preview.");
      const inspection = await inspectClient(client, false);
      const backup = await readDataset(client, true);
      const protection = await readProtection(client);
      const sourceData = source?.data ?? Object.fromEntries(SYNC_TABLES.map((table) => [table, []])) as unknown as SyncDataset;
      const input = { mode: mode === "merge" ? "merge" as const : "replace" as const, source: sourceData, destination: backup, protected: protection.protected, sourceImageOrigins: source?.sourceImageOrigins, archiveBlockedDeletes: true };
      let plan = planDatabaseSync(input);
      const blockedDeletes = new Map<string, BlockedDelete>();
      // Archiving a child may make its parent non-deletable: resolve the full graph before review.
      for (let pass = 0; pass <= SYNC_TABLES.length; pass++) {
        const blocked = await findBlockedDeletes(client, plan);
        if (blocked.length === 0) break;
        const previousSize = blockedDeletes.size;
        for (const item of blocked) blockedDeletes.set(`${item.table}:${item.id}`, item);
        if (blockedDeletes.size === previousSize || pass === SYNC_TABLES.length) {
          plan.blockers.push("Deletion dependencies could not be resolved safely. Review the referenced records.");
          break;
        }
        plan = planDatabaseSync({ ...input, blockedDeletes: [...blockedDeletes.values()] });
      }
      if (source && (selectedSignature(source.inspection.tables) !== selectedSignature(inspection.tables) || source.inspection.migrations.join("\n") !== inspection.migrations.join("\n"))) {
        plan.blockers.push("Source and destination schema or migrations differ. Review them before copying.");
      }
      const previousVisibility = parseDatabaseSyncVisibility(protection.rows.SiteSetting?.find((row) => row.key === DATABASE_SYNC_VISIBILITY_KEY)?.value ?? EMPTY_DATABASE_SYNC_VISIBILITY);
      const importedDealers = new Set(Object.values(plan.mappedDealerIds ?? {}));
      const importedListings = new Set(Object.values(plan.mappedListingIds ?? {}));
      const unique = (values: string[]) => [...new Set(values)].sort();
      const visibility = parseDatabaseSyncVisibility({
        archivedListingIds: unique([...previousVisibility.archivedListingIds.filter((id) => !importedListings.has(id)), ...(plan.archivedListingIds ?? [])]),
        archivedDealerIds: unique([...previousVisibility.archivedDealerIds.filter((id) => !importedDealers.has(id)), ...(plan.archivedDealerProfileIds ?? [])]),
        visibleDealerIds: unique([...(mode === "merge" ? previousVisibility.visibleDealerIds.filter((id) => !importedDealers.has(id)) : []), ...(source?.visibleDealerIds ?? []).map((id) => plan.mappedDealerIds?.[id]).filter((id): id is string => Boolean(id))]),
      });
      const id = randomUUID();
      const frozen: FrozenSnapshot = { plan, backup, protection, destinationHash: stableHash({ backup, protection }), sourceCapturedAt: new Date().toISOString(), visibility };
      assertSnapshotSize(frozen);
      const encrypted = seal(frozen, id, env);
      verifySealed(frozen, encrypted, id, env);
      const result = await client.query<StoredRun>(`INSERT INTO staging_admin.database_sync_runs(id,actor_id,mode,status,expires_at,encrypted_snapshot,summary)
        VALUES ($1,$2,$3,'prepared',now()+interval '30 minutes',$4,$5::jsonb) RETURNING *`, [id, actorId, mode, encrypted, JSON.stringify({ counts: plan.counts, blockers: plan.blockers, archivedListings: plan.archivedListingIds?.length ?? 0, archivedDealers: plan.archivedDealerProfileIds?.length ?? 0 })]);
      await client.query("COMMIT");
      return publicRun(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function applyDatabaseSync(runId: string, actorId: string, env: NodeJS.ProcessEnv = process.env): Promise<DatabaseSyncRun> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new DatabaseSyncError("Invalid sync preview.");
  return withDestination(env, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='30s'");
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(176923, 20261003) AS locked");
      if (!lock.rows[0]?.locked) throw new DatabaseSyncError("Another database sync is running.");
      await requireActor(client, actorId);
      const result = await client.query<StoredRun>("SELECT * FROM staging_admin.database_sync_runs WHERE id=$1 FOR UPDATE", [runId]);
      const row = result.rows[0];
      if (!row || row.actor_id !== actorId) throw new DatabaseSyncError("Prepare a sync preview with your own administrator account.");
      if (row.status === "applied") { await client.query("COMMIT"); return publicRun(row); }
      if (row.expires_at.getTime() <= Date.now()) throw new DatabaseSyncError("This preview has expired. Prepare a new preview.");
      const frozen = unseal<FrozenSnapshot>(row.encrypted_snapshot, runId, env);
      if (frozen.plan.blockers.length) throw new DatabaseSyncError("Resolve all preview blockers before applying this sync.");
      // EXCLUSIVE permits ordinary reads but stops writes and new FK references.
      await client.query(`LOCK TABLE ${[...SYNC_TABLES, "DealerPreviewPack", "SampleCheckout", "SiteSetting"].map((table) => `public.${quote(table)}`).join(",")} IN EXCLUSIVE MODE`);
      await requireActor(client, actorId);
      const backup = await readDataset(client, true);
      const protection = await readProtection(client);
      if (stableHash({ backup, protection }) !== frozen.destinationHash) throw new DatabaseSyncError("Development changed after this preview. Prepare a new preview; nothing was changed.");
      const blocked = await findBlockedDeletes(client, frozen.plan);
      if (blocked.length) throw new DatabaseSyncError("Other development records now reference rows marked for removal. Prepare a new preview.");
      // Decrypt and compare the persisted backup immediately before the first mutation.
      verifySealed(frozen, row.encrypted_snapshot, runId, env);
      await executeOperations(client, frozen.plan.operations);
      if (frozen.visibility) await client.query(`INSERT INTO public."SiteSetting" (key,value,"updatedAt") VALUES ($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=EXCLUDED."updatedAt"`, [DATABASE_SYNC_VISIBILITY_KEY, JSON.stringify(frozen.visibility)]);
      const after = await readDataset(client, true);
      const afterProtection = await readProtection(client);
      const withoutRegistry = (snapshot: ProtectionSnapshot) => ({ ...snapshot, rows: { ...snapshot.rows, SiteSetting: snapshot.rows.SiteSetting?.filter((row) => row.key !== DATABASE_SYNC_VISIBILITY_KEY) } });
      if (stableHash(withoutRegistry(protection)) !== stableHash(withoutRegistry(afterProtection))) throw new DatabaseSyncError("Protected development records changed. The sync was rolled back.");
      if (frozen.visibility && stableHash(afterProtection.rows.SiteSetting?.find((item) => item.key === DATABASE_SYNC_VISIBILITY_KEY)?.value) !== stableHash(frozen.visibility)) throw new DatabaseSyncError("Archive visibility verification failed. The sync was rolled back.");
      const afterIds = new Map(SYNC_TABLES.map((table) => [table, new Map(after[table].map((item) => [String(item.id), item]))]));
      for (const table of SYNC_TABLES) {
        const changes = frozen.plan.operations.filter((operation) => operation.table === table);
        const expectedCount = backup[table].length + changes.filter((operation) => operation.action === "insert").length - changes.filter((operation) => operation.action === "delete").length;
        if (after[table].length !== expectedCount) throw new DatabaseSyncError("Unexpected row-count change. The sync was rolled back.");
        for (const before of backup[table]) {
          const change = changes.find((operation) => operation.key === before.id && ["update", "delete"].includes(operation.action));
          if (change?.action === "delete") continue;
          const expected = change?.action === "update" ? { ...before, ...change.after } : before;
          if (stableHash(expected) !== stableHash(afterIds.get(table)!.get(String(before.id)))) throw new DatabaseSyncError("A preserved row or field changed unexpectedly. The sync was rolled back.");
        }
      }
      for (const operation of frozen.plan.operations) {
        const actual = afterIds.get(operation.table)!.get(operation.key);
        if (operation.action === "delete" && actual) throw new DatabaseSyncError("Removal verification failed. The sync was rolled back.");
        if (operation.action === "insert" || operation.action === "update") {
          if (!actual || Object.entries(operation.after!).some(([key, value]) => stableHash(actual[key]) !== stableHash(value))) throw new DatabaseSyncError("Copied row verification failed. The sync was rolled back.");
        }
      }
      const saved = await client.query<StoredRun>("UPDATE staging_admin.database_sync_runs SET status='applied',applied_at=now(),post_hash=$2 WHERE id=$1 RETURNING *", [runId, stableHash({ backup: after, protection: afterProtection })]);
      await client.query("COMMIT");
      return publicRun(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

