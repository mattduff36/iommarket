import { signedImageKitDeliveryUrl, uploadPrivateImageKitFile } from "@/lib/media/imagekit-api";
import { mediaDatabaseIdentity } from "@/lib/media/environment-boundary";

const PREVIEW_PROJECT = "syneonzucehwlghqmfbg";
const PRODUCTION_PROJECT = "snlqivvogfqesxpbjiei";
const TRADE_PATH =
  /^\/iommarket-trade-private\/(production|staging|local)\/(listings|evidence)\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,80})\/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp|pdf)$/;

export type TradeStorageScope = "production" | "staging" | "local";

export function tradeStorageScope(env: NodeJS.ProcessEnv = process.env): TradeStorageScope | null {
  const keys = ["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"] as const;
  const identities = keys
    .map((key) => env[key])
    .filter((value): value is string => Boolean(value))
    .map((value) => mediaDatabaseIdentity(value));
  if (identities.length === 0 || identities.some((identity) => !identity)) return null;
  const identity = identities[0];
  if (!identities.every((value) => value === identity)) return null;
  if (identity === "local") return env.VERCEL_ENV === "production" ? null : "local";
  if (identity === PREVIEW_PROJECT) return env.VERCEL_ENV === "production" ? null : "staging";
  if (identity === PRODUCTION_PROJECT) return env.VERCEL_ENV === "production" ? "production" : null;
  return null;
}

export function assertTradeFilePath(filePath: string, env: NodeJS.ProcessEnv = process.env) {
  const match = TRADE_PATH.exec(filePath);
  const scope = tradeStorageScope(env);
  if (!match || !scope || match[1] !== scope) {
    throw new Error("Private trade file is not available.");
  }
  return { scope, kind: match[2] as "listings" | "evidence" };
}

function extensionFor(contentType: string): "jpg" | "png" | "webp" | "pdf" {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "application/pdf") return "pdf";
  throw new Error("This file type is not allowed.");
}

export async function storeTradeFile(input: {
  bytes: Buffer;
  contentType: string;
  kind: "listings" | "evidence";
  ownerId: string;
  objectId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const scope = tradeStorageScope(env);
  if (!scope || !/^[A-Za-z0-9_-]{1,80}$/.test(input.ownerId) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.objectId)) {
    throw new Error("Private storage is not available.");
  }
  const extension = extensionFor(input.contentType);
  const name = input.kind === "evidence" ? "evidence" : "photo";
  const folder = `/iommarket-trade-private/${scope}/${input.kind}/${input.ownerId}/${input.objectId}`;
  const stored = await uploadPrivateImageKitFile({
    bytes: input.bytes,
    fileName: `${name}.${extension}`,
    folder,
    env,
  });
  assertTradeFilePath(stored.filePath, env);
  if (!stored.filePath.startsWith(`${folder}/`)) throw new Error("Private storage is not available.");
  return stored;
}

export async function readTradeFile(filePath: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
  assertTradeFilePath(filePath, env);
  const url = signedImageKitDeliveryUrl({ relativePath: filePath, env });
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { bytes, contentType };
}

export async function deleteTradeFile(fileId: string, filePath: string, env: NodeJS.ProcessEnv = process.env) {
  assertTradeFilePath(filePath, env);
  const privateKey = env.IMAGEKIT_PRIVATE_KEY ?? "";
  if (!privateKey || !/^[A-Za-z0-9_-]{1,120}$/.test(fileId)) throw new Error("Private storage is not available.");
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}` },
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error("The private file could not be removed.");
  }
}
