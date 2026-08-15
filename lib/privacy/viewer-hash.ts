import { createHmac } from "crypto";

export const VIEWER_HASH_VERSION = 1;

export function getViewerHashSecret(
  env: Record<string, string | undefined> = process.env,
) {
  const secret = env.VIEWER_HASH_SECRET?.trim();
  return secret || null;
}

export function buildViewerHash(input: {
  listingId: string;
  userId?: string | null;
  ip?: string | null;
  secret?: string | null;
  version?: number;
}) {
  const secret = input.secret ?? getViewerHashSecret();
  if (!secret) return null;

  const version = input.version ?? VIEWER_HASH_VERSION;
  const material = input.userId
    ? `user|${input.listingId}|${input.userId}`
    : `anon|${input.listingId}|${input.ip ?? "unknown"}`;
  const digest = createHmac("sha256", secret).update(material).digest("hex");

  return {
    viewerHash: `v${version}:${digest}`,
    viewerHashVersion: version,
  };
}
