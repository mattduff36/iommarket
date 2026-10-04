import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { assertSnapshotSize, DatabaseSyncError, stableHash } from "./snapshot";

function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.DATABASE_SYNC_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new DatabaseSyncError("The staging backup encryption key is not configured.");
  return Buffer.from(raw, "hex");
}

export function seal(value: unknown, runId: string, env: NodeJS.ProcessEnv = process.env): string {
  assertSnapshotSize(value);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), nonce);
  cipher.setAAD(Buffer.from(`itrader-database-sync-v1:${runId}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function unseal<T>(raw: string, runId: string, env: NodeJS.ProcessEnv = process.env): T {
  try {
    const [version, iv, tag, data, extra] = raw.split(".");
    if (version !== "v1" || extra !== undefined) throw new Error("Invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(`itrader-database-sync-v1:${runId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as T;
  } catch {
    throw new DatabaseSyncError("The encrypted backup could not be verified. No data was changed.");
  }
}

export function verifySealed(value: unknown, encrypted: string, runId: string, env: NodeJS.ProcessEnv = process.env) {
  if (stableHash(value) !== stableHash(unseal(encrypted, runId, env))) throw new DatabaseSyncError("Backup verification failed.");
}

export async function assertStoreReady(client: PoolClient) {
  const result = await client.query<{ present: boolean }>(`SELECT
    to_regclass('staging_admin.database_sync_runs') IS NOT NULL
    AND to_regclass('staging_admin.database_sync_chunks') IS NOT NULL
    AND to_regclass('staging_admin.database_sync_provenance') IS NOT NULL
    AND to_regclass('staging_admin.database_sync_state') IS NOT NULL AS present`);
  if (!result.rows[0]?.present) throw new DatabaseSyncError("Development sync storage has not been installed.");
  const version = await client.query<{ store_version: number | null }>("SELECT store_version FROM staging_admin.database_sync_state WHERE id=1");
  if (version.rows[0]?.store_version != null && version.rows[0].store_version !== 2) {
    throw new DatabaseSyncError("Development sync storage is out of date. Nothing was changed.");
  }
}
