import pg from "pg";
import { FOUNDING_ADVISORY_LOCK } from "./safety";

function cleanUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    return parsed.toString();
  } catch {
    return raw.trim();
  }
}

export async function withFoundingAdvisoryLock<T>(
  databaseUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString: cleanUrl(databaseUrl),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [FOUNDING_ADVISORY_LOCK]);
  try {
    return await fn();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [FOUNDING_ADVISORY_LOCK]);
    } finally {
      await client.end();
    }
  }
}
