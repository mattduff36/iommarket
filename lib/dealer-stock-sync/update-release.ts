import { constants, verify } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import releaseKey from "@/lib/dealer-stock-sync/update-public-key.json";

export const RELEASE_BUCKET = "stock-update-releases";
export const RELEASE_ORIGIN = "https://syneonzucehwlghqmfbg.supabase.co";
const version = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const envelopeSchema = z.object({ payload: z.string().min(1).max(12000), signature: z.string().min(1).max(1024) }).strict();
const payloadSchema = z.object({
  version: z.string().regex(version), channel: z.literal("preview"),
  objectKey: z.string().max(200), fileName: z.string().max(100),
  size: z.number().int().positive().max(262144000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function verifyRelease(value: unknown, publicKey = releaseKey.pem) {
  const envelope = envelopeSchema.parse(value);
  for (const encoded of [envelope.payload, envelope.signature]) {
    if (Buffer.from(encoded, "base64").toString("base64") !== encoded) throw new Error("Invalid release encoding");
  }
  const bytes = Buffer.from(envelope.payload, "base64");
  if (!verify("sha256", bytes, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(envelope.signature, "base64"))) throw new Error("Invalid release signature");
  const release = payloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const fileName = `iTrader-Stock-Update-${release.version}.exe`;
  if (release.fileName !== fileName || release.objectKey !== `preview/${release.version}/${fileName}`) throw new Error("Invalid release path");
  return { envelope, release };
}

export async function getUpdateRelease() {
  if (!isStagingOnlyFeatureEnabled()) throw new Error("Updates unavailable");
  const storage = createSupabaseAdminClient().storage.from(RELEASE_BUCKET);
  const { data, error } = await storage.download("preview/latest.json");
  if (error || !data || data.size > 16384) throw new Error("Release unavailable");
  const { envelope, release } = verifyRelease(JSON.parse(await data.text()));
  const signed = await storage.createSignedUrl(release.objectKey, 600, { download: release.fileName });
  if (signed.error || !signed.data) throw new Error("Download unavailable");
  const url = new URL(signed.data.signedUrl);
  if (url.origin !== RELEASE_ORIGIN || url.pathname !== `/storage/v1/object/sign/${RELEASE_BUCKET}/${release.objectKey}` || url.username || url.password || url.hash) throw new Error("Invalid download destination");
  return { ...envelope, downloadUrl: url.href, version: release.version };
}
