import pg from "pg";
import { requireNonPoolingConnectionString, sanitiseConnectionString } from "./env";
import type { PgClientLike } from "./types";

const { Client } = pg;

export function createFixerrorsClient(
  env: Record<string, string | undefined> = process.env,
): InstanceType<typeof Client> {
  const connectionString = sanitiseConnectionString(requireNonPoolingConnectionString(env));
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, "") || "postgres",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

export function asPgClient(client: InstanceType<typeof Client>): PgClientLike {
  return client as unknown as PgClientLike;
}
