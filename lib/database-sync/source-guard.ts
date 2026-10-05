import type { PoolClient } from "pg";
import { DatabaseSyncError } from "./snapshot";

const READ_ONLY_SOURCE_SQL = /^(?:select|show|begin|commit|rollback)\b/i;
const ALLOWED_SOURCE_SETTING = /^set\s+local\s+statement_timeout\b/i;

export function assertSourceReadOnlySql(sql: string) {
  const text = sql.trim();
  if (READ_ONLY_SOURCE_SQL.test(text) || ALLOWED_SOURCE_SETTING.test(text)) return;
  throw new DatabaseSyncError("The production source refused a statement that is not read-only.");
}

export function guardSourceClient(client: PoolClient): PoolClient {
  const query = client.query.bind(client);
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (sql: unknown, parameters?: unknown) => {
          if (typeof sql === "string") assertSourceReadOnlySql(sql);
          else if (sql && typeof sql === "object" && "text" in sql && typeof (sql as { text?: unknown }).text === "string") {
            assertSourceReadOnlySql((sql as { text: string }).text);
          }
          return query(sql as never, parameters as never);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
