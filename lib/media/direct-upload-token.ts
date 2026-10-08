import { createHmac } from "node:crypto";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";
import { assertPairedMediaProvider } from "@/lib/media/provider-config";
import { managedMediaScope, managedUploadPaths, type ManagedInputFormat } from "@/lib/media/managed-policy";

export const IMAGEKIT_DIRECT_UPLOAD_URL = "https://upload.imagekit.io/api/v2/files/upload";
export const IMAGEKIT_UPLOAD_TOKEN_TTL_SECONDS = 300;

export function assertManagedUploadsConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (env.IMAGEKIT_UPLOADS_ENABLED !== "1") throw new Error("Managed ImageKit uploads are disabled.");
  assertPairedMediaProvider(env);
  if (env.IMAGEKIT_URL_ENDPOINT !== "https://ik.imagekit.io/itraderim" ||
    !env.IMAGEKIT_PUBLIC_KEY || !env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("Managed ImageKit uploads require credentials for the verified account.");
  }
  return managedMediaScope(env);
}

/**
 * Upload V2 binds every multipart field except file/token. Do not replace this
 * with V1's token signature, which does not bind privacy, folder or overwrite.
 * https://imagekit.io/docs/api-reference/upload-file/upload-file-v2
 */
export function createImageKitUploadToken(input: {
  userId: string;
  intentId: string;
  format: ManagedInputFormat;
  env?: NodeJS.ProcessEnv;
  now?: number;
}) {
  const env = input.env ?? process.env;
  const scope = assertManagedUploadsConfigured(env);
  const paths = managedUploadPaths(scope, input.userId, input.intentId, input.format);
  const mimes = input.format === "heic" || input.format === "heif"
    ? ["image/heic", "image/heif"]
    : [input.format === "jpg" ? "image/jpeg" : `image/${input.format}`];
  const fields: Record<string, string> = {
    fileName: `source.${input.format}`,
    folder: paths.quarantineFolder,
    isPrivateFile: "true",
    useUniqueFileName: "false",
    overwriteFile: "false",
    responseFields: "isPrivateFile",
    checks: `"file.size" > 0 AND "file.size" <= ${IMAGE_CONSTRAINTS.maxFileSizeBytes} AND "file.mime" IN [${mimes.map((mime) => `"${mime}"`).join(",")}]`,
  };
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const exp = iat + IMAGEKIT_UPLOAD_TOKEN_TTL_SECONDS;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: env.IMAGEKIT_PUBLIC_KEY })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ...fields, iat, exp })).toString("base64url");
  const signature = createHmac("sha256", env.IMAGEKIT_PRIVATE_KEY!).update(`${header}.${payload}`).digest("base64url");
  return {
    provider: "imagekit" as const,
    strategy: "direct-v2" as const,
    uploadUrl: IMAGEKIT_DIRECT_UPLOAD_URL,
    finalizeUrl: "/api/listing-images/imagekit-finalize",
    fields: { ...fields, token: `${header}.${payload}.${signature}` } as Record<string, string> & { token: string },
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
