import { createHash, randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { AUTH_TOKEN_COLUMNS, adminIdentityCollision, authScrubViolations, preservedAuthCollision, scrubAuthUser, scrubIdentity, type AdminIdentity } from "./auth-clone";
import { loadCloneCatalog, type CatalogTable } from "./catalog";
import { canonicalBytes, hashCanonical, parseCanonical, quoteIdent, restoreValueExpression, selectExpression } from "./codec";
import { chunkAad, openChunk, sealChunk } from "./chunks";
import { SCHEMA_FINGERPRINT_SQL, hashSchemaLines } from "./fingerprint";
import { planCloneOrder, type CloneForeignKey } from "./order";
import { inspectDatabaseSyncConfiguration, inspectionPoolOptions } from "./preflight";
import { BACKUP_BUDGET_BYTES, planBackupRetention, type BackupPoint } from "./retention";
import { resolvePreviewSessionUrl } from "./session";
import { DatabaseSyncError } from "./snapshot";
import { assertStoreReady, seal, unseal } from "./store";

export const APPLY_DEADLINE_MS = 240_000;
export const APPLY_STATEMENT_TIMEOUT = "240s";
const PAGE = 200;
const SESSION_TABLES = ["sessions", "refresh_tokens", "mfa_factors", "mfa_challenges", "mfa_amr_claims", "one_time_tokens", "flow_state"];

export type CloneManifest = {
  v: 2;
  mode: "merge" | "replace" | "reset";
  fingerprint: string;
  blockers: string[];
  tables: Array<{ key: string; schema: string; name: string; primaryKey: string; rows: number; sha256: string }>;
  insertOrder: string[];
  deleteOrder: string[];
  deferredConstraints: string[];
  nullThenUpdate: Array<{ table: string; columns: string[] }>;
  preservedAdminIds: string[];
  preservedAuthIds: string[];
  previewInstanceId: string | null;
};

type ColumnMeta = { name: string; dataType: string };
type Relation = { schema: string; name: string; key: string; primaryKey: string };
type StoredRun = {
  id: string;
  actor_id: string;
  mode: string;
  status: "prepared" | "applied";
  created_at: Date;
  expires_at: Date;
  encrypted_snapshot: string;
  summary: unknown;
  kind: string | null;
  restored_from_id: string | null;
  schema_fingerprint: string | null;
  backup_bytes: string | null;
  backup_expires_at: Date | null;
  payload_pruned_at: Date | null;
};

export function lockCloneTablesSql(publicTables: readonly string[]): string {
  const names = [...publicTables.map((table) => `public.${quoteIdent(table)}`), "auth.users", "auth.identities"];
  return `LOCK TABLE ${names.join(", ")} IN SHARE ROW EXCLUSIVE MODE`;
}

export function assertCloneDeadline(deadline: number) {
  if (Date.now() > deadline) throw new DatabaseSyncError("The database operation exceeded its safe time limit and was rolled back.");
}

function cloneRelations(catalog: CatalogTable[]): Relation[] {
  return [
    ...catalog.map((table) => ({ schema: "public", name: table.name, key: table.name, primaryKey: table.primaryKey })),
    { schema: "auth", name: "users", key: "auth.users", primaryKey: "id" },
    { schema: "auth", name: "identities", key: "auth.identities", primaryKey: "id" },
  ];
}

function backupRelations(catalog: CatalogTable[]): Relation[] {
  return [
    ...cloneRelations(catalog),
    { schema: "staging_admin", name: "database_sync_provenance", key: "staging_admin.database_sync_provenance", primaryKey: "id" },
    { schema: "staging_admin", name: "database_sync_state", key: "staging_admin.database_sync_state", primaryKey: "id" },
  ];
}

async function columns(client: PoolClient, schema: string, table: string): Promise<ColumnMeta[]> {
  const result = await client.query<{ name: string; data_type: string }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS data_type
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [schema, table],
  );
  return result.rows.map((row) => ({ name: row.name, dataType: row.data_type }));
}

async function foreignKeys(client: PoolClient): Promise<CloneForeignKey[]> {
  const result = await client.query<{ name: string; child: string; parent: string; child_columns: string[]; nullable_columns: string[]; deferrable: boolean }>(
    `SELECT f.conname AS name, child.relname AS child, parent.relname AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum ORDER BY ord) AS child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(f.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum AND NOT a.attnotnull) AS nullable_columns,
      f.condeferrable AS deferrable
     FROM pg_constraint f
     JOIN pg_class child ON child.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
     JOIN pg_class parent ON parent.oid=f.confrelid
     WHERE f.contype='f' AND ns.nspname='public'`,
  );
  return result.rows.map((row) => ({
    name: row.name, child: row.child, parent: row.parent, childColumns: row.child_columns,
    nullable: row.child_columns.length > 0 && row.nullable_columns.length === row.child_columns.length, deferrable: row.deferrable,
  }));
}

async function fingerprint(client: PoolClient): Promise<string> {
  const result = await client.query<{ line: string }>(SCHEMA_FINGERPRINT_SQL);
  return hashSchemaLines(result.rows.map((row) => row.line));
}

async function admins(client: PoolClient): Promise<AdminIdentity[]> {
  const result = await client.query<AdminIdentity>(`SELECT id, email, "authUserId" FROM public."User" WHERE role='ADMIN' AND "disabledAt" IS NULL AND "deletedAt" IS NULL`);
  return result.rows;
}

async function requireActor(client: PoolClient, actorId: string) {
  const actor = await client.query(`SELECT id FROM public."User" WHERE id=$1 AND role='ADMIN' AND "disabledAt" IS NULL AND "deletedAt" IS NULL`, [actorId]);
  if (actor.rowCount !== 1) throw new DatabaseSyncError("An active development administrator is required.");
}

function cell(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

async function writeChunks(reader: PoolClient, writer: PoolClient, relation: Relation, runId: string, purpose: string, env: NodeJS.ProcessEnv, deadline: number, scrubInstanceId: string | null = null) {
  const meta = await columns(reader, relation.schema, relation.name);
  const hash = createHash("sha256");
  let rows = 0;
  let bytes = 0;
  let seq = 0;
  let cursor: string | null = null;
  if (!meta.length) return { key: relation.key, schema: relation.schema, name: relation.name, primaryKey: relation.primaryKey, rows, sha256: hash.digest("hex"), bytes };
  const select = meta.map((column) => selectExpression(column.name, column.dataType)).join(", ");
  const qualified = `${relation.schema}.${quoteIdent(relation.name)}`;
  const pk = `${quoteIdent(relation.primaryKey)}::text`;
  while (true) {
    assertCloneDeadline(deadline);
    const result: { rows: Array<Record<string, unknown>> } = await reader.query(
      `SELECT ${select} FROM ${qualified} ${cursor ? `WHERE ${pk} > $1` : ""} ORDER BY ${pk} LIMIT ${PAGE}`,
      cursor ? [cursor] : [],
    );
    if (!result.rows.length) break;
    const shaped = meta.map((column) => ({ name: column.name, type: column.dataType }));
    const matrix = result.rows.map((row) => meta.map((column) => row[column.name] == null ? null : String(row[column.name])));
    const payload = scrubInstanceId && (relation.key === "auth.users" || relation.key === "auth.identities")
      ? scrubMatrix(relation.key, shaped, matrix, scrubInstanceId) : matrix;
    const canonical = canonicalBytes(relation.key, shaped, payload);
    hash.update(canonical);
    const sealed = await sealChunk(canonical, chunkAad(runId, purpose, relation.key, seq), env);
    bytes += sealed.bytes;
    if (bytes > BACKUP_BUDGET_BYTES) throw new DatabaseSyncError("The newest backup exceeds the 500 MB ciphertext limit. Nothing was changed.");
    await writer.query(
      `INSERT INTO staging_admin.database_sync_chunks(run_id,purpose,table_name,seq,ciphertext,plaintext_sha256,row_count,byte_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [runId, purpose, relation.key, seq, sealed.ciphertext, hashCanonical(canonical), payload.length, sealed.bytes],
    );
    rows += payload.length;
    cursor = String(result.rows.at(-1)?.[relation.primaryKey] ?? "");
    seq += 1;
    if (result.rows.length < PAGE) break;
  }
  return { key: relation.key, schema: relation.schema, name: relation.name, primaryKey: relation.primaryKey, rows, sha256: hash.digest("hex"), bytes };
}

async function readChunkRows(client: PoolClient, runId: string, purpose: string, table: string, env: NodeJS.ProcessEnv) {
  const result = await client.query<{ seq: number; ciphertext: string }>(
    `SELECT seq, ciphertext FROM staging_admin.database_sync_chunks WHERE run_id=$1 AND purpose=$2 AND table_name=$3 ORDER BY seq`,
    [runId, purpose, table],
  );
  const rows: Array<Array<string | null>> = [];
  let columns: Array<{ name: string; type: string }> = [];
  for (const chunk of result.rows) {
    const parsed = parseCanonical(await openChunk(chunk.ciphertext, chunkAad(runId, purpose, table, chunk.seq), env));
    columns = parsed.columns;
    rows.push(...parsed.rows);
  }
  return { columns, rows };
}

function insertSql(relation: Relation, columnList: Array<{ name: string; type: string }>, conflict: "insert" | "merge") {
  const names = columnList.map((column) => quoteIdent(column.name)).join(",");
  const values = columnList.map((column, index) => restoreValueExpression(column.type, index)).join(",");
  const update = columnList.filter((column) => column.name !== relation.primaryKey).map((column) => `${quoteIdent(column.name)}=EXCLUDED.${quoteIdent(column.name)}`).join(",");
  const base = `INSERT INTO ${relation.schema}.${quoteIdent(relation.name)} (${names}) SELECT ${values} FROM jsonb_array_elements($1::jsonb) elem`;
  return conflict === "merge" && update ? `${base} ON CONFLICT (${quoteIdent(relation.primaryKey)}) DO UPDATE SET ${update}` : base;
}

async function writeRows(client: PoolClient, relation: Relation, columnList: Array<{ name: string; type: string }>, rows: Array<Array<string | null>>, conflict: "insert" | "merge") {
  if (!columnList.length || !rows.length) return;
  for (let index = 0; index < rows.length; index += PAGE) {
    await client.query(insertSql(relation, columnList, conflict), [JSON.stringify(rows.slice(index, index + PAGE))]);
  }
}

function scrubMatrix(table: string, columnList: Array<{ name: string; type: string }>, rows: Array<Array<string | null>>, instanceId: string) {
  if (table !== "auth.users" && table !== "auth.identities") return rows;
  return rows.map((row) => {
    const record = Object.fromEntries(columnList.map((column, index) => [column.name, row[index]]));
    const scrubbed = table === "auth.users" ? scrubAuthUser(record, instanceId) : scrubIdentity(record);
    if (table === "auth.users" && authScrubViolations(scrubbed).length) throw new DatabaseSyncError("Imported authentication records were not made non-login.");
    return columnList.map((column) => cell(scrubbed[column.name]));
  });
}

async function captureRelations(client: PoolClient, list: Relation[], runId: string, purpose: string, env: NodeJS.ProcessEnv, deadline: number) {
  let bytes = 0;
  const tables = [];
  for (const relation of list) {
    const captured = await writeChunks(client, client, relation, runId, purpose, env, deadline);
    bytes += captured.bytes;
    tables.push(captured);
    if (bytes > BACKUP_BUDGET_BYTES) throw new DatabaseSyncError("The newest backup exceeds the 500 MB ciphertext limit. Nothing was changed.");
  }
  return { bytes, tables };
}

async function enforceRetention(client: PoolClient, runId: string, bytes: number, now = Date.now()) {
  const existing = await client.query<{ id: string; backup_bytes: string; created_at: Date; backup_expires_at: Date | null; newest: boolean }>(
    `SELECT id, backup_bytes::text, created_at, backup_expires_at, backup_expires_at IS NULL AND payload_pruned_at IS NULL AND backup_bytes > 0 AS newest
     FROM staging_admin.database_sync_runs WHERE status='applied' AND id<>$1 AND payload_pruned_at IS NULL AND backup_bytes > 0`,
    [runId],
  );
  const points: BackupPoint[] = existing.rows.map((row) => ({
    id: row.id, createdAt: row.created_at.getTime(), bytes: Number(row.backup_bytes), expiresAt: row.backup_expires_at?.getTime() ?? null, newest: row.newest,
  }));
  const plan = planBackupRetention(points, now, { id: runId, bytes });
  if (!plan.ok) throw new DatabaseSyncError(plan.reason);
  for (const update of plan.expireUpdates) {
    await client.query(`UPDATE staging_admin.database_sync_runs SET backup_expires_at=to_timestamp($2 / 1000.0) WHERE id=$1`, [update.id, update.expiresAt]);
  }
  for (const id of plan.dropIds) {
    await client.query(`DELETE FROM staging_admin.database_sync_chunks WHERE run_id=$1 AND purpose='backup'`, [id]);
    await client.query(`UPDATE staging_admin.database_sync_runs SET payload_pruned_at=now(), backup_bytes=0 WHERE id=$1`, [id]);
  }
}

async function clearSessions(client: PoolClient, ids: string[], mode: "except" | "only" = "except") {
  if (mode === "only" && ids.length === 0) return;
  const predicate = mode === "only" ? "user_id::text = ANY($1::text[])" : "NOT (user_id::text = ANY($1::text[]))";
  for (const table of SESSION_TABLES) {
    const present = await client.query<{ present: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS present`, [`auth.${table}`]);
    if (!present.rows[0]?.present) continue;
    const meta = await columns(client, "auth", table);
    if (!meta.some((column) => column.name === "user_id")) continue;
    await client.query(`DELETE FROM auth.${quoteIdent(table)} WHERE ${predicate}`, [ids]);
  }
}

async function verifyImportedAuth(client: PoolClient, ids: string[], mode: "except" | "only") {
  if (mode === "only" && ids.length === 0) return;
  const tokens = AUTH_TOKEN_COLUMNS.map((column) => `${quoteIdent(column)} IS DISTINCT FROM ''`).join(" OR ");
  const scope = mode === "only" ? "id::text = ANY($1::text[])" : "NOT (id::text = ANY($1::text[]))";
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM auth.users WHERE ${scope} AND (banned_until IS DISTINCT FROM 'infinity'::timestamptz OR encrypted_password IS DISTINCT FROM '' OR ${tokens})`,
    [ids],
  );
  if (result.rows[0]?.count !== "0") throw new DatabaseSyncError("Imported authentication records were not made non-login.");
  const sessions = await client.query<{ present: boolean }>(`SELECT to_regclass('auth.sessions') IS NOT NULL AS present`);
  if (!sessions.rows[0]?.present) return;
  const sessionScope = mode === "only" ? "user_id::text = ANY($1::text[])" : "NOT (user_id::text = ANY($1::text[]))";
  const leftover = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM auth.sessions WHERE ${sessionScope}`, [ids]);
  if (leftover.rows[0]?.count !== "0") throw new DatabaseSyncError("Imported authentication records were not made non-login.");
}

async function replay(client: PoolClient, manifest: CloneManifest, runId: string, purpose: string, env: NodeJS.ProcessEnv, deadline: number, scrub: boolean) {
  const catalog = cloneRelations(loadCloneCatalog());
  const byKey = new Map(catalog.map((relation) => [relation.key, relation]));
  if (manifest.mode !== "merge") {
    for (const step of manifest.nullThenUpdate) {
      if (step.columns.length) await client.query(`UPDATE public.${quoteIdent(step.table)} SET ${step.columns.map((column) => `${quoteIdent(column)}=NULL`).join(",")}`);
    }
    for (const name of manifest.deferredConstraints) await client.query(`SET CONSTRAINTS ${quoteIdent(name)} DEFERRED`);
    for (const key of manifest.deleteOrder) {
      assertCloneDeadline(deadline);
      const relation = byKey.get(key);
      if (!relation || relation.schema !== "public") continue;
      if (relation.name === "User" && manifest.preservedAdminIds.length) {
        await client.query(`DELETE FROM public."User" WHERE NOT (id = ANY($1::text[]))`, [manifest.preservedAdminIds]);
      } else await client.query(`DELETE FROM public.${quoteIdent(relation.name)}`);
    }
    await client.query(`DELETE FROM auth.identities WHERE NOT (user_id::text = ANY($1::text[]))`, [manifest.preservedAuthIds]);
    await client.query(`DELETE FROM auth.users WHERE NOT (id::text = ANY($1::text[]))`, [manifest.preservedAuthIds]);
    await clearSessions(client, manifest.preservedAuthIds);
  }
  if (manifest.mode === "reset") {
    await client.query(`DELETE FROM staging_admin.database_sync_provenance`);
    await client.query(`INSERT INTO staging_admin.database_sync_state(id, active_generation_id, schema_fingerprint, store_version) VALUES (1, NULL, $1, 2) ON CONFLICT (id) DO UPDATE SET active_generation_id=NULL, schema_fingerprint=EXCLUDED.schema_fingerprint, store_version=2`, [manifest.fingerprint]);
    return;
  }
  const originals = new Map<string, { columns: Array<{ name: string; type: string }>; rows: Array<Array<string | null>> }>();
  const importedAuthIds: string[] = [];
  for (const key of ["auth.users", "auth.identities", ...manifest.insertOrder]) {
    assertCloneDeadline(deadline);
    const relation = byKey.get(key);
    if (!relation) continue;
    const loaded = await readChunkRows(client, runId, purpose, key, env);
    const rows = (scrub ? scrubMatrix(key, loaded.columns, loaded.rows, manifest.previewInstanceId ?? "") : loaded.rows).filter((row) => {
      const idIndex = loaded.columns.findIndex((column) => column.name === relation.primaryKey || (key === "auth.identities" && column.name === "user_id"));
      const id = idIndex >= 0 ? row[loaded.columns.findIndex((column) => column.name === (key.startsWith("auth.") ? (key === "auth.identities" ? "user_id" : "id") : relation.primaryKey))] : null;
      if (key === "auth.users" || key === "auth.identities") return !manifest.preservedAuthIds.includes(String(id));
      if (relation.name === "User") return !manifest.preservedAdminIds.includes(String(row[loaded.columns.findIndex((column) => column.name === "id")]));
      return true;
    });
    const blankIndexes = new Set(manifest.nullThenUpdate.filter((step) => step.table === relation.name).flatMap((step) => step.columns.map((column) => loaded.columns.findIndex((item) => item.name === column))).filter((index) => index >= 0));
    const firstPass = rows.map((row) => row.map((value, index) => blankIndexes.has(index) ? null : value));
    try {
      await writeRows(client, relation, loaded.columns, firstPass, manifest.mode === "merge" ? "merge" : "insert");
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") throw new DatabaseSyncError(`${relation.name} conflicts with a different development identity on a unique key.`);
      throw error;
    }
    if (blankIndexes.size) originals.set(relation.name, { columns: loaded.columns, rows });
    if (key === "auth.users") {
      const index = loaded.columns.findIndex((column) => column.name === "id");
      for (const row of rows) if (typeof row[index] === "string") importedAuthIds.push(row[index]);
    }
  }
  for (const [table, payload] of originals) {
    const relation = byKey.get(table);
    if (relation) await writeRows(client, relation, payload.columns, payload.rows, "merge");
  }
  if (!scrub) return;
  if (manifest.mode === "merge") {
    await clearSessions(client, importedAuthIds, "only");
    await client.query(`INSERT INTO staging_admin.database_sync_provenance(generation_id, table_name, row_key)
      SELECT $1::uuid, table_name, row_key FROM staging_admin.database_sync_provenance
      WHERE generation_id = (SELECT active_generation_id FROM staging_admin.database_sync_state WHERE id = 1)
      ON CONFLICT DO NOTHING`, [runId]);
  } else await client.query(`DELETE FROM staging_admin.database_sync_provenance`);
  for (const table of manifest.tables) {
    const loaded = await readChunkRows(client, runId, purpose, table.key, env);
    const idIndex = loaded.columns.findIndex((column) => column.name === table.primaryKey);
    const keys = loaded.rows.map((row) => row[idIndex]).filter((id): id is string => typeof id === "string" && !manifest.preservedAdminIds.includes(id) && !manifest.preservedAuthIds.includes(id));
    for (let index = 0; index < keys.length; index += PAGE) {
      await client.query(`INSERT INTO staging_admin.database_sync_provenance(generation_id, table_name, row_key) SELECT $1::uuid, $2, key FROM unnest($3::text[]) key ON CONFLICT DO NOTHING`, [runId, table.key, keys.slice(index, index + PAGE)]);
    }
  }
  await client.query(`DELETE FROM staging_admin.database_sync_provenance WHERE generation_id IS DISTINCT FROM $1::uuid`, [runId]);
  await client.query(`INSERT INTO staging_admin.database_sync_state(id, active_generation_id, schema_fingerprint, store_version) VALUES (1, $1::uuid, $2, 2) ON CONFLICT (id) DO UPDATE SET active_generation_id=EXCLUDED.active_generation_id, schema_fingerprint=EXCLUDED.schema_fingerprint, store_version=2`, [runId, manifest.fingerprint]);
  await verifyImportedAuth(client, manifest.mode === "merge" ? importedAuthIds : manifest.preservedAuthIds, manifest.mode === "merge" ? "only" : "except");
}

async function withSession<T>(env: NodeJS.ProcessEnv, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!isStagingOnlyFeatureEnabled(env)) throw new DatabaseSyncError("Database sync is available only on the verified staging database.");
  const config = inspectDatabaseSyncConfiguration(env);
  if (!config.destination) throw new DatabaseSyncError("Development database identity could not be verified.");
  const sessionUrl = resolvePreviewSessionUrl(env);
  const pool = new pg.Pool(inspectionPoolOptions(sessionUrl, env));
  const client = await pool.connect();
  try {
    await assertStoreReady(client);
    await client.query("BEGIN");
    try {
      await client.query(`DELETE FROM staging_admin.database_sync_chunks c USING staging_admin.database_sync_runs r
        WHERE c.run_id = r.id AND c.purpose = 'source' AND r.status = 'prepared' AND r.expires_at <= now()`);
      await client.query(`UPDATE staging_admin.database_sync_runs SET payload_pruned_at = now()
        WHERE status = 'prepared' AND expires_at <= now() AND payload_pruned_at IS NULL`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function beginLocked(client: PoolClient, actorId: string) {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(`SET LOCAL statement_timeout='${APPLY_STATEMENT_TIMEOUT}'`);
  await client.query(`SET LOCAL idle_in_transaction_session_timeout='${APPLY_STATEMENT_TIMEOUT}'`);
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(176923, 20261003) AS locked");
  if (!lock.rows[0]?.locked) throw new DatabaseSyncError("Another database sync is running.");
  await requireActor(client, actorId);
}

export async function prepareClone(mode: "merge" | "replace" | "reset", actorId: string, env: NodeJS.ProcessEnv) {
  const catalog = loadCloneCatalog();
  const id = randomUUID();
  const deadline = Date.now() + APPLY_DEADLINE_MS;
  return withSession(env, async (destination) => {
    await destination.query("BEGIN");
    try {
      await destination.query(`SET LOCAL statement_timeout='${APPLY_STATEMENT_TIMEOUT}'`);
      await requireActor(destination, actorId);
      const recent = await destination.query<{ count: string }>("SELECT count(*) FROM staging_admin.database_sync_runs WHERE actor_id=$1 AND created_at > now()-interval '1 minute'", [actorId]);
      if (Number(recent.rows[0]?.count) >= 3) throw new DatabaseSyncError("Please wait a minute before preparing another preview.");
      const preserved = await admins(destination);
      const order = planCloneOrder(catalog.map((table) => table.name), await foreignKeys(destination));
      const instance = await destination.query<{ id: string }>(`SELECT instance_id::text AS id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1`);
      const manifest: CloneManifest = {
        v: 2, mode, fingerprint: await fingerprint(destination), blockers: [...order.blockers], tables: [],
        insertOrder: order.insertOrder, deleteOrder: order.deleteOrder, deferredConstraints: order.deferredConstraints,
        nullThenUpdate: order.nullThenUpdate, preservedAdminIds: preserved.map((admin) => admin.id),
        preservedAuthIds: preserved.map((admin) => admin.authUserId), previewInstanceId: instance.rows[0]?.id ?? null,
      };
      await destination.query(
        `INSERT INTO staging_admin.database_sync_runs(id, actor_id, mode, status, expires_at, encrypted_snapshot, summary, kind, schema_fingerprint)
         VALUES ($1,$2,$3,'prepared',now()+interval '30 minutes',$4,$5::jsonb,'sync',$6)`,
        [id, actorId, mode, seal({ ...manifest, tables: [] }, id, env), JSON.stringify({ counts: {}, blockers: manifest.blockers, archivedListings: 0, archivedDealers: 0 }), manifest.fingerprint],
      );
      let sourceBytes = 0;
      if (mode !== "reset") {
        const config = inspectDatabaseSyncConfiguration(env);
        if (!config.source) throw new DatabaseSyncError("A dedicated production read-only connection is required.");
        const sourcePool = new pg.Pool(inspectionPoolOptions(config.source, env));
        const source = await sourcePool.connect();
        try {
          await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          await source.query(`SET LOCAL statement_timeout='${APPLY_STATEMENT_TIMEOUT}'`);
          if ((await fingerprint(source)) !== manifest.fingerprint) manifest.blockers.push("Source and destination schema or migrations differ. Review them before copying.");
          const users = await source.query<AdminIdentity>(`SELECT id, email, "authUserId" FROM public."User"`);
          for (const user of users.rows) {
            const collision = adminIdentityCollision(preserved, user);
            if (collision) manifest.blockers.push(collision);
          }
          const authUsers = await source.query<{ id: string }>(`SELECT id::text AS id FROM auth.users`);
          const publicIdByAuth = new Map(users.rows.map((user) => [user.authUserId, user.id]));
          for (const user of authUsers.rows) {
            const collision = preservedAuthCollision(preserved, user.id, publicIdByAuth.get(user.id) ?? null);
            if (collision) manifest.blockers.push(collision);
          }
          if (!manifest.previewInstanceId) manifest.blockers.push("The preview authentication instance could not be read.");
          if (!manifest.blockers.length) {
            for (const relation of cloneRelations(catalog)) {
              const captured = await writeChunks(source, destination, relation, id, "source", env, deadline, manifest.previewInstanceId);
              sourceBytes += captured.bytes;
              manifest.tables.push(captured);
              if (sourceBytes > BACKUP_BUDGET_BYTES) throw new DatabaseSyncError("The newest backup exceeds the 500 MB ciphertext limit. Nothing was changed.");
            }
          }
          await source.query("COMMIT");
        } finally {
          await source.query("ROLLBACK").catch(() => undefined);
          source.release();
          await sourcePool.end();
        }
      }
      const summary = { counts: Object.fromEntries(manifest.tables.map((table) => [table.name, { insert: table.rows, update: 0, delete: 0, preserve: 0, skip: 0 }])), blockers: manifest.blockers, archivedListings: 0, archivedDealers: 0 };
      const inserted = await destination.query<StoredRun>(
        `UPDATE staging_admin.database_sync_runs SET encrypted_snapshot=$2, summary=$3::jsonb, schema_fingerprint=$4 WHERE id=$1 RETURNING *`,
        [id, seal(manifest, id, env), JSON.stringify(summary), manifest.fingerprint],
      );
      await destination.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await destination.query("ROLLBACK");
      throw error;
    }
  });
}

export async function applyClone(runId: string, actorId: string, env: NodeJS.ProcessEnv) {
  const deadline = Date.now() + APPLY_DEADLINE_MS;
  return withSession(env, async (client) => {
    try {
      await beginLocked(client, actorId);
      const stored = await client.query<StoredRun>(`SELECT * FROM staging_admin.database_sync_runs WHERE id=$1 FOR UPDATE`, [runId]);
      const row = stored.rows[0];
      if (!row || row.actor_id !== actorId) throw new DatabaseSyncError("Prepare a sync preview with your own administrator account.");
      if (row.status === "applied") { await client.query("COMMIT"); return row; }
      if (row.expires_at.getTime() <= Date.now()) throw new DatabaseSyncError("This preview has expired. Prepare a new preview.");
      const manifest = unseal<CloneManifest>(row.encrypted_snapshot, runId, env);
      if (manifest.blockers.length) throw new DatabaseSyncError("Resolve all preview blockers before applying this sync.");
      await client.query(lockCloneTablesSql(loadCloneCatalog().map((table) => table.name)));
      await requireActor(client, actorId);
      if ((await fingerprint(client)) !== manifest.fingerprint) throw new DatabaseSyncError("Schema changed after this preview. Prepare a new preview. Nothing was changed.");
      const backup = await captureRelations(client, backupRelations(loadCloneCatalog()), runId, "backup", env, deadline);
      await enforceRetention(client, runId, backup.bytes);
      await replay(client, manifest, runId, "source", env, deadline, true);
      await client.query(`DELETE FROM staging_admin.database_sync_chunks WHERE run_id=$1 AND purpose='source'`, [runId]);
      const saved = await client.query<StoredRun>(`UPDATE staging_admin.database_sync_runs SET status='applied', applied_at=now(), backup_bytes=$2, backup_expires_at=NULL WHERE id=$1 RETURNING *`, [runId, backup.bytes]);
      await client.query("COMMIT");
      return saved.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function restoreClone(runId: string, actorId: string, env: NodeJS.ProcessEnv) {
  const deadline = Date.now() + APPLY_DEADLINE_MS;
  const catalog = loadCloneCatalog();
  return withSession(env, async (client) => {
    try {
      await beginLocked(client, actorId);
      const stored = await client.query<StoredRun>(`SELECT * FROM staging_admin.database_sync_runs WHERE id=$1 FOR UPDATE`, [runId]);
      const selected = stored.rows[0];
      if (!selected || selected.status !== "applied" || selected.payload_pruned_at || Number(selected.backup_bytes ?? 0) <= 0) {
        throw new DatabaseSyncError("This backup has expired and was removed.");
      }
      if (selected.backup_expires_at && selected.backup_expires_at.getTime() <= Date.now()) throw new DatabaseSyncError("This backup has expired and was removed.");
      const manifest = unseal<CloneManifest>(selected.encrypted_snapshot, runId, env);
      await client.query(lockCloneTablesSql(catalog.map((table) => table.name)));
      await requireActor(client, actorId);
      if ((await fingerprint(client)) !== manifest.fingerprint) throw new DatabaseSyncError("Schema changed after this backup. Nothing was changed.");
      const actor = await client.query<{ authUserId: string }>(`SELECT "authUserId" FROM public."User" WHERE id=$1`, [actorId]);
      const users = await readChunkRows(client, runId, "backup", "User", env);
      const auth = await readChunkRows(client, runId, "backup", "auth.users", env);
      const userId = users.columns.findIndex((column) => column.name === "id");
      const authId = auth.columns.findIndex((column) => column.name === "id");
      if (!users.rows.some((row) => row[userId] === actorId) || !auth.rows.some((row) => row[authId] === actor.rows[0]?.authUserId)) {
        throw new DatabaseSyncError("This restore would remove your administrator access.");
      }
      const newId = randomUUID();
      const summary = { counts: {}, blockers: [], archivedListings: 0, archivedDealers: 0 };
      const replayManifest: CloneManifest = { ...manifest, mode: "replace", preservedAdminIds: [], preservedAuthIds: [] };
      await client.query(
        `INSERT INTO staging_admin.database_sync_runs(id, actor_id, mode, status, expires_at, encrypted_snapshot, summary, kind, restored_from_id, schema_fingerprint, backup_bytes)
         VALUES ($1,$2,'replace','prepared',now(),$3,$4::jsonb,'restore',$5,$6,0)`,
        [newId, actorId, seal(replayManifest, newId, env), JSON.stringify(summary), runId, manifest.fingerprint],
      );
      const backup = await captureRelations(client, backupRelations(catalog), newId, "backup", env, deadline);
      await replay(client, replayManifest, runId, "backup", env, deadline, false);
      const provenance = await readChunkRows(client, runId, "backup", "staging_admin.database_sync_provenance", env);
      const state = await readChunkRows(client, runId, "backup", "staging_admin.database_sync_state", env);
      await client.query(`DELETE FROM staging_admin.database_sync_provenance`);
      await writeRows(client, { schema: "staging_admin", name: "database_sync_provenance", key: "staging_admin.database_sync_provenance", primaryKey: "id" }, provenance.columns, provenance.rows, "insert");
      if (state.rows.length) {
        await writeRows(client, { schema: "staging_admin", name: "database_sync_state", key: "staging_admin.database_sync_state", primaryKey: "id" }, state.columns, state.rows, "merge");
      } else {
        await client.query(`INSERT INTO staging_admin.database_sync_state(id, active_generation_id, schema_fingerprint, store_version) VALUES (1, NULL, $1, 2) ON CONFLICT (id) DO UPDATE SET active_generation_id=NULL, schema_fingerprint=EXCLUDED.schema_fingerprint, store_version=2`, [manifest.fingerprint]);
      }
      await enforceRetention(client, newId, backup.bytes);
      const saved = await client.query<StoredRun>(
        `UPDATE staging_admin.database_sync_runs SET status='applied', applied_at=now(), backup_bytes=$2, backup_expires_at=NULL WHERE id=$1 RETURNING *`,
        [newId, backup.bytes],
      );
      await client.query("COMMIT");
      return saved.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
