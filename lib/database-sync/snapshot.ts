import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { DESTINATION_COLUMNS, SOURCE_COLUMNS } from "./policy";
import { SYNC_TABLES, type SyncDataset, type SyncRow, type DatabaseSyncPlan, type BlockedDelete, type ProtectedSyncRows } from "./types";

export class DatabaseSyncError extends Error {}
export const MAX_SNAPSHOT_BYTES = 40 * 1024 * 1024;
export const MAX_TABLE_ROWS = 50_000;

export function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function stableHash(value: unknown): string {
  function canonical(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
    return JSON.stringify(item) ?? "null";
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function assertSnapshotSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_SNAPSHOT_BYTES) {
    throw new DatabaseSyncError("This snapshot exceeds the safe online sync limit. No data was changed.");
  }
}

/** JSON conversion in Postgres preserves decimal precision, arrays and timestamps. */
export async function readDataset(client: PoolClient, full = false, source = false): Promise<SyncDataset> {
  const result = {} as SyncDataset;
  for (const table of SYNC_TABLES) {
    const manifest = source ? SOURCE_COLUMNS : DESTINATION_COLUMNS;
    const columns = full ? "*" : manifest[table].map(quote).join(", ");
    const rows = await client.query<{ row: SyncRow }>(`SELECT to_jsonb(t) AS row FROM (SELECT ${columns} FROM public.${quote(table)} ORDER BY id LIMIT $1) t`, [MAX_TABLE_ROWS + 1]);
    if (rows.rows.length > MAX_TABLE_ROWS) throw new DatabaseSyncError(`The ${table} table exceeds the safe online sync limit.`);
    result[table] = rows.rows.map((item) => item.row);
  }
  assertSnapshotSize(result);
  return result;
}

export type ProtectionSnapshot = { rows: Record<string, SyncRow[]>; protected: ProtectedSyncRows };

export async function readProtection(client: PoolClient): Promise<ProtectionSnapshot> {
  const rows: Record<string, SyncRow[]> = {};
  // Full records are encrypted with the backup and included in drift/protection checks.
  for (const table of ["DealerPreviewPack", "SampleCheckout", "SiteSetting"] as const) {
    const orderBy = table === "SiteSetting" ? "key" : "id";
    const found = await client.query<{ row: SyncRow }>(`SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY ${quote(orderBy)} LIMIT $1`, [MAX_TABLE_ROWS + 1]);
    if (found.rows.length > MAX_TABLE_ROWS) throw new DatabaseSyncError("Protected development data exceeds the online sync limit.");
    rows[table] = found.rows.map((item) => item.row);
  }
  return { rows, protected: {
    previewPackDealerProfileIds: rows.DealerPreviewPack.map((row) => String(row.dealerProfileId)),
    sampleCheckoutTargetIds: rows.SampleCheckout.map((row) => String(row.targetId)),
  } };
}

type Reference = { child_schema: string; child_table: string; child_columns: string[]; parent_table: string; parent_columns: string[] };

/** Inspect every incoming FK, including CASCADE and SET NULL: no silent history loss. */
export async function findBlockedDeletes(client: PoolClient, plan: DatabaseSyncPlan): Promise<BlockedDelete[]> {
  const deletes = plan.operations.filter((operation) => operation.action === "delete");
  if (!deletes.length) return [];
  const references = await client.query<Reference>(`SELECT ns.nspname AS child_schema, child.relname AS child_table, parent.relname AS parent_table,
    ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum ORDER BY ord) AS child_columns,
    ARRAY(SELECT a.attname::text FROM unnest(f.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=k.attnum ORDER BY ord) AS parent_columns
    FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE f.contype='f' AND pn.nspname='public' AND parent.relname=ANY($1::text[])`, [[...new Set(deletes.map((item) => item.table))]]);
  const blocked = new Map<string, BlockedDelete>();
  for (const ref of references.rows) {
    const parents = deletes.filter((item) => item.table === ref.parent_table);
    const childDeletes = deletes.filter((item) => item.table === ref.child_table).map((item) => item.key);
    const join = ref.child_columns.map((column, index) => `c.${quote(column)}=p.${quote(ref.parent_columns[index])}`).join(" AND ");
    const managed = ref.child_schema === "public" && SYNC_TABLES.includes(ref.child_table as typeof SYNC_TABLES[number]);
    const found = await client.query<{ id: string }>(`SELECT DISTINCT p.id FROM public.${quote(ref.parent_table)} p JOIN ${quote(ref.child_schema)}.${quote(ref.child_table)} c ON ${join}
      WHERE p.id=ANY($1::text[]) ${managed ? "AND NOT (c.id=ANY($2::text[]))" : ""}`, managed ? [parents.map((item) => item.key), childDeletes] : [parents.map((item) => item.key)]);
    for (const row of found.rows) {
      const parent = parents.find((item) => item.key === row.id)!;
      const key = `${parent.table}:${parent.key}`;
      const entry = blocked.get(key) ?? { table: parent.table, id: parent.key, references: [] };
      entry.references.push(`${ref.child_schema}.${ref.child_table}`);
      blocked.set(key, entry);
    }
  }
  return [...blocked.values()];
}
