import { databaseSslOptions } from "../../lib/db/pool-options";
import pg from "pg";
import { requireNonPoolingConnectionString, sanitiseConnectionString } from "./env";
import type { PgClientLike } from "./types";
import { fixerrorsTimeouts, timeStage } from "./operations";

const { Client } = pg;

export function createFixerrorsClient(
  env: Record<string, string | undefined> = process.env,
): InstanceType<typeof Client> {
  const connectionString = sanitiseConnectionString(requireNonPoolingConnectionString(env));
  const url = new URL(connectionString);
  const timeouts = fixerrorsTimeouts(env);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, "") || "postgres",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: databaseSslOptions(connectionString, env),
    connectionTimeoutMillis: timeouts.FIXERRORS_CONNECT_TIMEOUT_MS,
    query_timeout: timeouts.FIXERRORS_QUERY_TIMEOUT_MS,
    statement_timeout: timeouts.FIXERRORS_STATEMENT_TIMEOUT_MS,
    lock_timeout: timeouts.FIXERRORS_LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: timeouts.FIXERRORS_QUERY_TIMEOUT_MS,
  });
}

export function asPgClient(client: InstanceType<typeof Client>): PgClientLike {
  return { query: async <T extends Record<string, unknown>>(text: string, values?: unknown[]) =>
    timeStage(`database ${text.trim().split(/\s/)[0]}`, () => client.query<T>(text, values)) };
}
