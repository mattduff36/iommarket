import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PoolClient } from "pg";
import type { TableData } from "./copy";
import { assertByteBudget } from "./limits";

export function encryptedBackup(data: TableData[], runId: string, keyHex: string): Buffer {
  const raw = Buffer.from(JSON.stringify(data));
  assertByteBudget(raw.length);
  const compressed = gzipSync(raw);
  const nonce = randomBytes(12), key = Buffer.from(keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(runId));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(runId));
  decipher.setAuthTag(tag);
  const verified = gunzipSync(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  if (!verified.equals(raw)) throw new Error("Backup verification failed");
  return Buffer.concat([nonce, tag, ciphertext]);
}

export async function recordProvenance(client: PoolClient, data: TableData[], generationId: string) {
  await client.query("DELETE FROM preview_mirror.provenance");
  await client.query("DELETE FROM preview_mirror.protected_references");
  const references = new Set<string>();
  for (const table of data.filter((t) => t.schema === "public")) {
    const ids = table.rows.map((row) => row.id).filter((id): id is string => id != null);
    await client.query("INSERT INTO preview_mirror.provenance SELECT $1::uuid,$2,unnest($3::text[]) ON CONFLICT DO NOTHING", [generationId, table.name, ids]);
    for (const row of table.rows) {
      for (const [name, value] of Object.entries(row)) {
        if (!value) continue;
        if (/email$/i.test(name)) references.add(JSON.stringify(["email", value.trim().toLowerCase()]));
        if (/^(publicId|imageKitFileId|imageKitFilePath|url|avatarUrl|logoUrl)$/.test(name)) references.add(JSON.stringify(["media", value]));
        if (/^(providerPaymentId|providerReference|providerSubscriptionId)$/.test(name) || (table.name === "Payment" && name === "id")) references.add(JSON.stringify(["payment", value]));
      }
    }
  }
  const refs = [...references].map((value) => JSON.parse(value) as string[]);
  for (let i = 0; i < refs.length; i += 500) {
    await client.query("INSERT INTO preview_mirror.protected_references SELECT $1::uuid,r->>0,r->>1 FROM jsonb_array_elements($2::jsonb) r ON CONFLICT DO NOTHING", [generationId, JSON.stringify(refs.slice(i, i + 500))]);
  }
}
