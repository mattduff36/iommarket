import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { quoteIdent } from "@/lib/database-sync/codec";
import { PreviewMirrorError } from "./error";
import { assertByteBudget } from "./limits";

export type Column = { name: string; type: string; generated: string; identity: string };
export type TableData = { schema: string; name: string; columns: Column[]; rows: Array<Record<string, string | null>> };
export const AUTH_ACCOUNTS = ["users", "identities", "mfa_factors"];
export const AUTH_RUNTIME = ["mfa_amr_claims", "mfa_challenges", "one_time_tokens", "refresh_tokens", "sessions", "flow_state", "oauth_authorizations", "audit_log_entries"];
export const qualified = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`;

export async function authTables(client: PoolClient): Promise<string[]> {
  return (await client.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname='auth' ORDER BY tablename")).rows.map((r) => r.name);
}

/** New authentication features must be explicitly supported before copying their credentials. */
export async function assertSupportedAuth(client: PoolClient): Promise<void> {
  const handled = new Set([...AUTH_ACCOUNTS, ...AUTH_RUNTIME, "schema_migrations", "instances"]);
  for (const name of await authTables(client)) {
    if (handled.has(name)) continue;
    const rows = await client.query(`SELECT 1 FROM ${qualified("auth", name)} LIMIT 1`);
    if (rows.rowCount) throw new PreviewMirrorError(`Authentication feature auth.${name} requires explicit mirror support. Nothing was replaced.`);
  }
}

export async function publicTables(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ name: string }>("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname");
  return result.rows.map((row) => row.name);
}

export async function readTable(client: PoolClient, schema: string, name: string): Promise<TableData> {
  const columns = (await client.query<Column>(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attgenerated AS generated,a.attidentity AS identity
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, name])).rows;
  if (!columns.length) throw new PreviewMirrorError("A required database table is missing.");
  const selections = columns.map((column) => `${quoteIdent(column.name)}::text AS ${quoteIdent(column.name)}`).join(",");
  const rows = (await client.query(`SELECT ${selections} FROM ${qualified(schema, name)}`)).rows as TableData["rows"];
  return { schema, name, columns, rows };
}

export async function capture(client: PoolClient, publicNames: string[], includeRuntime = false): Promise<TableData[]> {
  const relations = [...publicNames.map((name) => ({ schema: "public", name })),
    ...[...AUTH_ACCOUNTS, ...(includeRuntime ? AUTH_RUNTIME : [])].map((name) => ({ schema: "auth", name }))];
  const data: TableData[] = [];
  let bytes = 0;
  for (const relation of relations) {
    const table = await readTable(client, relation.schema, relation.name);
    bytes += Buffer.byteLength(JSON.stringify(table));
    assertByteBudget(bytes);
    data.push(table);
  }
  return data;
}

export function tableDigest(table: TableData): string {
  const rowHashes = table.rows.map((row) => createHash("sha256").update(JSON.stringify(table.columns.map((c) => row[c.name]))).digest("hex")).sort();
  return createHash("sha256").update(JSON.stringify(table.columns)).update(rowHashes.join("\n")).digest("hex");
}

export async function insertTable(client: PoolClient, table: TableData): Promise<void> {
  const columns = table.columns.filter((c) => !c.generated);
  if (columns.some((c) => !/^[a-zA-Z0-9_ ,[\]".()]+$/.test(c.type))) throw new PreviewMirrorError("Unsupported database type.");
  const select = columns.map((c, index) => `(r->>${index})::${c.type}`).join(",");
  const override = columns.some((c) => c.identity) ? " OVERRIDING SYSTEM VALUE" : "";
  for (let offset = 0; offset < table.rows.length; offset += 250) {
    const rows = table.rows.slice(offset, offset + 250).map((r) => columns.map((c) => r[c.name]));
    await client.query(`INSERT INTO ${qualified(table.schema, table.name)} (${columns.map((c) => quoteIdent(c.name)).join(",")})${override} SELECT ${select} FROM jsonb_array_elements($1::jsonb) AS r`, [JSON.stringify(rows)]);
  }
}

export async function verifyCopy(client: PoolClient, source: TableData[]): Promise<void> {
  for (const expected of source) {
    const actual = await readTable(client, expected.schema, expected.name);
    if (tableDigest(expected) !== tableDigest(actual)) throw new PreviewMirrorError(`Verification failed for ${expected.schema}.${expected.name}. Preview was not replaced.`);
  }
}
