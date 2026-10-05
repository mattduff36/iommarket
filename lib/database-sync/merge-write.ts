import { quoteIdent, restoreValueExpression } from "./codec";

export type CloneWriteColumn = { name: string; type: string; index: number; identity: string };
export type CloneWriteRelation = { schema: string; name: string; primaryKey: string };

/** Do not issue UPDATE for identical rows: append-only triggers correctly forbid it. */
export function cloneInsertSql(relation: CloneWriteRelation, writable: CloneWriteColumn[], conflict: "insert" | "merge"): string {
  const names = writable.map((column) => quoteIdent(column.name)).join(",");
  const values = writable.map((column) => restoreValueExpression(column.type, column.index)).join(",");
  const mutable = writable.filter((column) => column.name !== relation.primaryKey && column.identity === "");
  const update = mutable.map((column) => `${quoteIdent(column.name)}=EXCLUDED.${quoteIdent(column.name)}`).join(",");
  const override = writable.some((column) => column.identity === "a") ? " OVERRIDING SYSTEM VALUE" : "";
  const base = `INSERT INTO ${relation.schema}.${quoteIdent(relation.name)} AS sync_target (${names})${override} SELECT ${values} FROM jsonb_array_elements($1::jsonb) elem`;
  if (conflict !== "merge") return base;
  const target = quoteIdent(relation.primaryKey);
  if (!update) return `${base} ON CONFLICT (${target}) DO NOTHING`;
  // Compare the typed values we actually write. JSON conversion also supports json columns.
  const changed = mutable.map((column) => `to_jsonb(sync_target.${quoteIdent(column.name)}) IS DISTINCT FROM to_jsonb(EXCLUDED.${quoteIdent(column.name)})`).join(" OR ");
  return `${base} ON CONFLICT (${target}) DO UPDATE SET ${update} WHERE ${changed}`;
}
