import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { DatabaseSyncError } from "./snapshot";

const compress = promisify(gzip);
const decompress = promisify(gunzip);

function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.DATABASE_SYNC_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new DatabaseSyncError("The staging backup encryption key is not configured.");
  return Buffer.from(raw, "hex");
}

export function chunkAad(runId: string, purpose: string, table: string, seq: number): string {
  return `itrader-database-sync-v2:${runId}:${purpose}:${table}:${seq}`;
}

export async function sealChunk(plain: Buffer, aad: string, env: NodeJS.ProcessEnv): Promise<{ ciphertext: string; bytes: number }> {
  const compressed = await compress(plain);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), nonce);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const ciphertext = ["v2", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
  return { ciphertext, bytes: Buffer.byteLength(ciphertext) };
}

export async function openChunk(ciphertext: string, aad: string, env: NodeJS.ProcessEnv): Promise<Buffer> {
  try {
    const [version, iv, tag, data, extra] = ciphertext.split(".");
    if (version !== "v2" || extra !== undefined) throw new Error("Invalid chunk");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return await decompress(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]));
  } catch {
    throw new DatabaseSyncError("The encrypted backup could not be verified. No data was changed.");
  }
}
