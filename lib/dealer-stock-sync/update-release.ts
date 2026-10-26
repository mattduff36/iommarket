import { constants, verify } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveDesktopGate } from "@/lib/dealer-stock-sync/desktop-config";
import releaseKey from "@/lib/dealer-stock-sync/update-public-key.json";

export const RELEASE_BUCKET = "stock-update-releases";
export const RELEASE_ORIGIN = "https://syneonzucehwlghqmfbg.supabase.co";
const version = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const envelopeSchema = z.object({ payload: z.string().min(1).max(12000), signature: z.string().min(1).max(1024) }).strict();
const payloadSchema = z.object({
  version: z.string().regex(version), channel: z.enum(["preview", "production"]),
  objectKey: z.string().max(200), fileName: z.string().max(100),
  size: z.number().int().positive().max(262144000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function verifyRelease(value: unknown, publicKey = releaseKey.pem, channel: "preview" | "production" = "preview") {
  const envelope = envelopeSchema.parse(value);
  for (const encoded of [envelope.payload, envelope.signature]) {
    if (Buffer.from(encoded, "base64").toString("base64") !== encoded) throw new Error("Invalid release encoding");
  }
  const bytes = Buffer.from(envelope.payload, "base64");
  if (!verify("sha256", bytes, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(envelope.signature, "base64"))) throw new Error("Invalid release signature");
  const release = payloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const fileName = `iTrader-Stock-Update-${release.version}.exe`;
  if (release.channel !== channel || release.fileName !== fileName || release.objectKey !== [channel, release.version, fileName].join("/")) throw new Error("Invalid release path");
  return { envelope, release };
}

export async function getUpdateRelease() {
  const gate = resolveDesktopGate(process.env);
  if (!gate.ok) throw new Error("Updates unavailable");
  const channel = gate.gate.environment;
  const origin = channel === "preview" ? RELEASE_ORIGIN : "https://snlqivvogfqesxpbjiei.supabase.co";
  const storage = createSupabaseAdminClient().storage.from(RELEASE_BUCKET);
  const { data, error } = await storage.download(channel + "/latest.json");
  if (error || !data || data.size > 16384) throw new Error("Release unavailable");
  const { envelope, release } = verifyRelease(JSON.parse(await data.text()), releaseKey.pem, channel);
  const signed = await storage.createSignedUrl(release.objectKey, 600, { download: release.fileName });
  if (signed.error || !signed.data) throw new Error("Download unavailable");
  const url = new URL(signed.data.signedUrl);
  if (url.origin !== origin || url.pathname !== `/storage/v1/object/sign/${RELEASE_BUCKET}/${release.objectKey}` || url.username || url.password || url.hash) throw new Error("Invalid download destination");
  return { ...envelope, downloadUrl: url.href, version: release.version };
}
