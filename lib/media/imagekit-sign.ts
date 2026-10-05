import { createHmac, timingSafeEqual } from "node:crypto";

export interface ImageKitEndpoint {
  origin: string;
  basePath: string;
  href: string;
}

export function parseImageKitEndpoint(value: string | undefined): ImageKitEndpoint {
  if (!value) throw new Error("ImageKit endpoint is not configured.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ImageKit endpoint is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ImageKit endpoint must be a public HTTPS URL.");
  }
  if (url.hostname !== "ik.imagekit.io") {
    throw new Error("ImageKit endpoint host is not allowed.");
  }
  const basePath = url.pathname.replace(/\/$/, "");
  if (!basePath || basePath.includes("..")) {
    throw new Error("ImageKit endpoint path is not allowed.");
  }
  return { origin: url.origin, basePath, href: `${url.origin}${basePath}` };
}

export function assertSignableImageKitPath(relativePath: string) {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("..") ||
    relativePath.includes("\\") ||
    relativePath.includes("?") ||
    relativePath.includes("#") ||
    /\s/.test(relativePath)
  ) {
    throw new Error("ImageKit path cannot be signed.");
  }
  return relativePath;
}

export function signImageKitRelativePath(input: {
  endpoint: string;
  privateKey: string;
  relativePath: string;
  expiresAt: number;
}) {
  if (!input.privateKey) throw new Error("ImageKit private key is not configured.");
  if (!Number.isInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error("ImageKit signature expiry is invalid.");
  }
  const endpoint = parseImageKitEndpoint(input.endpoint);
  const relativePath = assertSignableImageKitPath(input.relativePath);
  const signature = createHmac("sha1", input.privateKey)
    .update(`${relativePath}${input.expiresAt}`)
    .digest("hex");
  const url = new URL(`${endpoint.href}/${relativePath}`);
  url.searchParams.set("ik-t", String(input.expiresAt));
  url.searchParams.set("ik-s", signature);
  return url.toString();
}

export function imageKitSignaturesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
