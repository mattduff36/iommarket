import type { PoolClient } from "pg";
import { PreviewMirrorError } from "./error";

export function assertSourceStatement(sql: string): void {
  const value = sql.trim();
  if (value.includes(";") || !(/^(SELECT|SHOW)\b/i.test(value) ||
    /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)$/i.test(value) ||
    /^SET LOCAL (statement_timeout|lock_timeout) = '[0-9]+ms'$/i.test(value))) {
    throw new PreviewMirrorError("A non-read-only source statement was refused.");
  }
}

export function guardedSource(client: PoolClient): PoolClient {
  return new Proxy(client, { get(target, property) {
    if (property === "query") return (sql: string, values?: unknown[]) => {
      assertSourceStatement(sql);
      return target.query(sql, values);
    };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

export async function startReadOnlySource(client: PoolClient): Promise<PoolClient> {
  // Supavisor can ignore startup options. Enforce this on the actual session.
  await client.query("SET SESSION default_transaction_read_only=on");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const result = await client.query("SHOW transaction_read_only");
  if (result.rows[0]?.transaction_read_only !== "on") {
    throw new PreviewMirrorError("Production read-only transaction could not be verified.");
  }
  return guardedSource(client);
}
