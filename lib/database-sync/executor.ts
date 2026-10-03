import type { PoolClient } from "pg";
import { SYNC_COLUMNS } from "./policy";
import { SYNC_TABLES, type SyncOperation } from "./types";
import { DatabaseSyncError, quote } from "./snapshot";

function validate(operation: SyncOperation) {
  if (!SYNC_TABLES.includes(operation.table)) throw new DatabaseSyncError("Unknown sync table.");
  if (operation.action === "delete") {
    if (["User", "Region", "Category", "AttributeDefinition", "VehicleMake", "VehicleModel", "VehicleModelAlias"].includes(operation.table)) {
      throw new DatabaseSyncError("This plan attempts to remove a protected identity or reference table.");
    }
    return;
  }
  const row = operation.after;
  if (!row || row.id !== operation.key || Object.keys(row).some((column) => !(SYNC_COLUMNS[operation.table] as readonly string[]).includes(column))) {
    throw new DatabaseSyncError("The frozen plan contains invalid fields.");
  }
  if (operation.table === "User" && (operation.action !== "insert" ||
    !String(row.authUserId).startsWith("database-sync:") || !String(row.email).endsWith("@example.invalid") ||
    !["USER", "DEALER"].includes(String(row.role)))) throw new DatabaseSyncError("Existing development accounts cannot be overwritten.");
}

function shape(operation: SyncOperation): string {
  return `${operation.table}:${operation.action}:${Object.keys(operation.after ?? {}).sort().join(",")}`;
}

/** Bounded batches retain dependency order and avoid thousands of network round trips. */
export async function executeOperations(client: PoolClient, operations: SyncOperation[]) {
  const mutations = operations.filter((operation) => operation.action !== "preserve" && operation.action !== "skip");
  for (const operation of mutations) validate(operation);
  for (let start = 0; start < mutations.length;) {
    const first = mutations[start];
    const batch = [first];
    while (batch.length < 200 && start + batch.length < mutations.length && shape(mutations[start + batch.length]) === shape(first)) batch.push(mutations[start + batch.length]);
    const table = `public.${quote(first.table)}`;
    let result;
    if (first.action === "delete") {
      result = await client.query(`DELETE FROM ${table} WHERE id=ANY($1::text[])`, [batch.map((item) => item.key)]);
    } else {
      const columns = Object.keys(first.after!).sort();
      const json = JSON.stringify(batch.map((item) => item.after));
      result = first.action === "insert"
        ? await client.query(`INSERT INTO ${table} (${columns.map(quote).join(",")}) SELECT ${columns.map(quote).join(",")} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [json])
        : await client.query(`UPDATE ${table} AS target SET ${columns.filter((column) => column !== "id").map((column) => `${quote(column)}=incoming.${quote(column)}`).join(",")}
            FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) incoming WHERE target.id=incoming.id`, [json]);
    }
    if (result.rowCount !== batch.length) throw new DatabaseSyncError("A planned row changed. The sync was rolled back; prepare a new preview.");
    start += batch.length;
  }
}
