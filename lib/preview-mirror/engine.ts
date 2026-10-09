import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { buildDatabasePoolOptions } from "@/lib/db/pool-options";
import { resolvePreviewSessionUrl } from "@/lib/database-sync/session";
import { quoteIdent } from "@/lib/database-sync/codec";
import { assertMirrorTargets, mirrorSourceUrl } from "./guards";
import { PreviewMirrorError } from "./error";
import { startReadOnlySource } from "./reader";
import { MIRROR_FINGERPRINT_SQL, mirrorSchemaCompatibility } from "./schema";
import { requiredMirrorTables, assertSamePublicCatalog } from "./coverage";
import { AUTH_ACCOUNTS, AUTH_RUNTIME, assertSupportedAuth, authTables, capture, insertTable, publicTables, qualified, tableDigest, verifyCopy, type TableData } from "./copy";
import { encryptedBackup, recordProvenance } from "./store";
import { automaticMirrorDue } from "./schedule";
import { MIRROR_DEADLINE_MS, MIRROR_INTERVAL_MS, MIRROR_LOCK_A, MIRROR_LOCK_B } from "./limits";

type Input = { trigger: "manual" | "automatic"; actorId?: string };
export type MirrorResult = { status: "applied" | "not-due" | "busy"; runId?: string; copiedTables?: number; copiedRows?: number };
type ForeignKey = { table_name: string; name: string; definition: string; deferrable: boolean; deferred: boolean };
type State = { generation_id: string | null; last_success_at: Date | null; last_attempt_at: Date | null; last_error: string | null };

async function readState(client: PoolClient): Promise<State> {
  const exists = await client.query("SELECT to_regclass('preview_mirror.state') IS NOT NULL AS present");
  if (!exists.rows[0]?.present) throw new PreviewMirrorError("Preview refresh has not been installed.");
  const result = await client.query<State>("SELECT * FROM preview_mirror.state WHERE id=1");
  if (!result.rows[0]) throw new PreviewMirrorError("Preview refresh state is missing.");
  return result.rows[0];
}

export async function readMirrorStatus(env: NodeJS.ProcessEnv = process.env) {
  assertMirrorTargets(env);
  const pool = new pg.Pool({ ...buildDatabasePoolOptions(resolvePreviewSessionUrl(env), env), max: 1, connectionTimeoutMillis: 15_000 });
  try {
    const client = await pool.connect();
    try {
      const state = await readState(client);
      const last = state.last_success_at?.getTime() ?? null;
      return { lastSuccessAt: last == null ? null : new Date(last).toISOString(), nextAutomaticAt: last == null ? null : new Date(last + MIRROR_INTERVAL_MS).toISOString(), lastError: state.last_error };
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function foreignKeys(client: PoolClient): Promise<ForeignKey[]> {
  return (await client.query<ForeignKey>(`SELECT c.relname AS table_name,f.conname AS name,pg_get_constraintdef(f.oid) AS definition,
    f.condeferrable AS deferrable,f.condeferred AS deferred
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND f.contype='f' ORDER BY c.relname,f.conname`)).rows;
}

async function restoreSequences(client: PoolClient, tables: string[]) {
  const seqs = (await client.query<{ table_name: string; column_name: string; schema_name: string; sequence_name: string; increment: string; minimum: string }>(`SELECT t.relname AS table_name,a.attname AS column_name,n.nspname AS schema_name,s.relname AS sequence_name,p.seqincrement::text AS increment,p.seqmin::text AS minimum
    FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence p ON p.seqrelid=s.oid
    JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE n.nspname='public' AND s.relkind='S'`)).rows;
  for (const seq of seqs) {
    if (!tables.includes(seq.table_name) || BigInt(seq.increment) <= 0n) throw new PreviewMirrorError("Unsupported sequence configuration.");
    const result = await client.query(`SELECT MAX(${quoteIdent(seq.column_name)})::text AS maximum FROM public.${quoteIdent(seq.table_name)}`);
    const next = result.rows[0].maximum == null ? BigInt(seq.minimum) : BigInt(result.rows[0].maximum) + BigInt(seq.increment);
    await client.query(`ALTER SEQUENCE ${qualified(seq.schema_name, seq.sequence_name)} RESTART WITH ${next.toString()}`);
  }
}

async function replaceData(client: PoolClient, source: TableData[], tables: string[]) {
  const keys = await foreignKeys(client);
  for (const fk of keys) await client.query(`ALTER TABLE public.${quoteIdent(fk.table_name)} ALTER CONSTRAINT ${quoteIdent(fk.name)} DEFERRABLE INITIALLY DEFERRED`);
  // One TRUNCATE avoids immutable DELETE triggers and retains all constraints.
  await client.query(`TRUNCATE TABLE ${tables.map((name) => qualified("public", name)).join(",")}`);
  for (const name of AUTH_RUNTIME) await client.query(`DELETE FROM auth.${quoteIdent(name)}`);
  await client.query('DELETE FROM auth."identities"');
  await client.query('DELETE FROM auth."mfa_factors"');
  await client.query('DELETE FROM auth."users"');
  for (const name of AUTH_ACCOUNTS) await insertTable(client, source.find((t) => t.schema === "auth" && t.name === name)!);
  for (const table of source.filter((t) => t.schema === "public")) await insertTable(client, table);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  for (const fk of keys) await client.query(`ALTER TABLE public.${quoteIdent(fk.table_name)} ALTER CONSTRAINT ${quoteIdent(fk.name)} ${fk.deferrable ? `DEFERRABLE INITIALLY ${fk.deferred ? "DEFERRED" : "IMMEDIATE"}` : "NOT DEFERRABLE"}`);
  await restoreSequences(client, tables);
  await verifyCopy(client, source);
}

/** Internal shared engine. Callers cannot choose connections through HTTP inputs. */
export async function mirrorWithClients(input: Input, sourceClient: PoolClient, destination: PoolClient, key: string): Promise<MirrorResult> {
  const started = Date.now(), runId = randomUUID();
  let sourceOpen = false, destinationOpen = false, locked = false;
  const deadline = () => { if (Date.now() - started > MIRROR_DEADLINE_MS) throw new PreviewMirrorError("Preview refresh timed out. No partial copy was committed."); };
  try {
    locked = (await destination.query("SELECT pg_try_advisory_lock($1,$2) AS locked", [MIRROR_LOCK_A, MIRROR_LOCK_B])).rows[0]?.locked === true;
    if (!locked) return { status: "busy" };
    const state = await readState(destination);
    if (input.trigger === "automatic" && !automaticMirrorDue(state.last_success_at?.getTime() ?? null, Date.now())) return { status: "not-due" };
    if (state.last_attempt_at && Date.now() - state.last_attempt_at.getTime() < 60_000) return { status: "busy" };
    await destination.query("UPDATE preview_mirror.state SET last_attempt_at=now(),last_error=NULL WHERE id=1");
    const source = await startReadOnlySource(sourceClient);
    sourceOpen = true;
    await source.query("SET LOCAL statement_timeout = '240000ms'");
    const names = await publicTables(source);
    const targetNames = await publicTables(destination);
    assertSamePublicCatalog(names, targetNames, requiredMirrorTables());
    const sourceSchema = (await source.query<{ line: string }>(MIRROR_FINGERPRINT_SQL)).rows.map((r) => r.line);
    await assertSupportedAuth(source);
    const data = await capture(source, names);
    await source.query("COMMIT");
    sourceOpen = false;
    deadline();
    await destination.query("BEGIN");
    destinationOpen = true;
    await destination.query("SET LOCAL statement_timeout='240s'");
    await destination.query("SET LOCAL lock_timeout='15s'");
    const accountRelations = (await authTables(destination)).filter((n) => n !== "schema_migrations" && n !== "instances");
    await destination.query(`LOCK TABLE ${[...names.map((n) => qualified("public", n)), ...accountRelations.map((n) => qualified("auth", n))].join(",")} IN ACCESS EXCLUSIVE MODE`);
    await assertSupportedAuth(destination);
    const targetSchema = (await destination.query<{ line: string }>(MIRROR_FINGERPRINT_SQL)).rows.map((r) => r.line);
    if (mirrorSchemaCompatibility(sourceSchema, targetSchema).blockers.length) throw new PreviewMirrorError("Source and preview schemas differ. Nothing was replaced.");
    const backupData = await capture(destination, names, true);
    for (const table of data.filter((t) => t.schema === "auth")) {
      const target = backupData.find((t) => t.schema === "auth" && t.name === table.name);
      if (JSON.stringify(table.columns) !== JSON.stringify(target?.columns)) throw new PreviewMirrorError("Authentication schemas differ. Nothing was replaced.");
    }
    const backup = encryptedBackup(backupData, runId, key);
    deadline();
    await replaceData(destination, data, names);
    deadline();
    await recordProvenance(destination, data, runId);
    const verification = data.map((t) => ({ table: `${t.schema}.${t.name}`, rows: t.rows.length, sha256: tableDigest(t) }));
    const copiedRows = data.reduce((n, t) => n + t.rows.length, 0);
    await destination.query("INSERT INTO preview_mirror.runs(id,trigger_kind,actor_id,copied_tables,copied_rows,verification,backup) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)", [runId, input.trigger, input.actorId ?? null, names.length, copiedRows, JSON.stringify(verification), backup]);
    await destination.query("UPDATE preview_mirror.state SET generation_id=$1,last_success_at=now(),last_error=NULL WHERE id=1", [runId]);
    await destination.query("DELETE FROM preview_mirror.runs WHERE id NOT IN (SELECT id FROM preview_mirror.runs ORDER BY completed_at DESC LIMIT 3)");
    deadline();
    await destination.query("COMMIT");
    destinationOpen = false;
    return { status: "applied", runId, copiedTables: names.length, copiedRows };
  } catch (error) {
    if (destinationOpen) await destination.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof PreviewMirrorError ? error.message : "Preview refresh failed. Check the saved run state before retrying.";
    if (locked) await destination.query("UPDATE preview_mirror.state SET last_error=$1 WHERE id=1", [message]).catch(() => undefined);
    throw new PreviewMirrorError(message);
  } finally {
    if (sourceOpen) await sourceClient.query("ROLLBACK").catch(() => undefined);
    if (locked) await destination.query("SELECT pg_advisory_unlock($1,$2)", [MIRROR_LOCK_A, MIRROR_LOCK_B]).catch(() => undefined);
  }
}

export async function refreshPreviewMirror(input: Input, env: NodeJS.ProcessEnv = process.env): Promise<MirrorResult> {
  assertMirrorTargets(env);
  const sourcePool = new pg.Pool({ ...buildDatabasePoolOptions(mirrorSourceUrl(env), env), max: 1, connectionTimeoutMillis: 15_000 });
  const targetPool = new pg.Pool({ ...buildDatabasePoolOptions(resolvePreviewSessionUrl(env), env), max: 1, connectionTimeoutMillis: 15_000 });
  let source: PoolClient | undefined, target: PoolClient | undefined;
  try {
    target = await targetPool.connect();
    source = await sourcePool.connect();
    return await mirrorWithClients(input, source, target, env.PREVIEW_MIRROR_ENCRYPTION_KEY!);
  } finally {
    source?.release(true); target?.release(true);
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}
