import type { PoolClient } from "pg";
import { quoteIdent } from "./codec";
import type { SyncActionCounts } from "./types";

export type SyncCountInput = {
  mode: "merge" | "replace";
  sourceKeys: readonly string[];
  destinationKeys: readonly string[];
  skippedSourceKeys: readonly string[];
  preservedDestinationKeys: readonly string[];
};

export function classifySyncCounts(input: SyncCountInput): SyncActionCounts {
  const source = new Set(input.sourceKeys);
  const destination = new Set(input.destinationKeys);
  const skipped = new Set(input.skippedSourceKeys);
  const preserved = new Set(input.preservedDestinationKeys);
  let skip = 0;
  let insert = 0;
  let update = 0;
  for (const key of source) {
    if (skipped.has(key)) {
      skip += 1;
      continue;
    }
    if (input.mode === "merge" && destination.has(key)) update += 1;
    else insert += 1;
  }
  let preserve = 0;
  let deleted = 0;
  for (const key of destination) {
    const kept = input.mode === "merge" ? skipped.has(key) || !source.has(key) : preserved.has(key);
    if (kept) preserve += 1;
    else if (input.mode === "replace") deleted += 1;
  }
  return { captured: source.size, insert, update, delete: deleted, preserve, skip };
}

export type UniqueConstraint = {
  name: string;
  columnNames: string[];
  nullsNotDistinct: boolean;
};

export async function loadUniqueConstraints(client: PoolClient, schema: string, table: string): Promise<UniqueConstraint[]> {
  const result = await client.query<{ name: string; column_names: string[] | null; nulls_not_distinct: boolean }>(
    `SELECT idx.relname AS name,
        (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k.attnum) AS column_names,
        COALESCE(i.indnullsnotdistinct, false) AS nulls_not_distinct
     FROM pg_index i
     JOIN pg_class rel ON rel.oid = i.indrelid
     JOIN pg_class idx ON idx.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE i.indisunique AND NOT i.indisprimary AND i.indexprs IS NULL AND i.indpred IS NULL
       AND NOT (0 = ANY (i.indkey)) AND n.nspname = $1 AND rel.relname = $2`,
    [schema, table],
  );
  return result.rows.flatMap((row) => row.column_names?.length
    ? [{ name: row.name, columnNames: row.column_names, nullsNotDistinct: row.nulls_not_distinct }]
    : []);
}

export async function hasUniqueConflict(
  client: PoolClient,
  relation: { schema: string; name: string; primaryKey: string },
  columns: readonly { name: string }[],
  rows: readonly (readonly (string | null)[])[],
  constraint: UniqueConstraint,
): Promise<boolean> {
  const indexes = constraint.columnNames.map((name) => columns.findIndex((column) => column.name === name));
  const primaryIndex = columns.findIndex((column) => column.name === relation.primaryKey);
  if (indexes.some((index) => index < 0) || primaryIndex < 0) return false;
  const values = constraint.columnNames.map(() => [] as string[]);
  const primaryKeys: string[] = [];
  for (const row of rows) {
    const key = row[primaryIndex];
    const cells = indexes.map((index) => row[index]);
    if (typeof key !== "string") continue;
    if (!constraint.nullsNotDistinct && cells.some((cell) => cell == null)) continue;
    if (cells.some((cell) => cell == null)) continue;
    cells.forEach((cell, index) => values[index].push(String(cell)));
    primaryKeys.push(key);
  }
  if (!primaryKeys.length) return false;
  const aliases = constraint.columnNames.map((_, index) => `c${index}`);
  const comparison = constraint.columnNames.map((name, index) => `d.${quoteIdent(name)}::text = u.${aliases[index]}`).join(" AND ");
  const unnest = aliases.map((_, index) => `$${index + 1}::text[]`).join(", ");
  const result = await client.query(
    `SELECT 1 FROM ${relation.schema}.${quoteIdent(relation.name)} d
     JOIN unnest(${unnest}) AS u(${aliases.join(", ")}) ON ${comparison}
     WHERE NOT (d.${quoteIdent(relation.primaryKey)}::text = ANY($${aliases.length + 1}::text[]))
     LIMIT 1`,
    [...values, primaryKeys],
  );
  return (result.rowCount ?? 0) > 0;
}
