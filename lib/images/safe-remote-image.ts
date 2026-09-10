import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";

const DEFAULT_TIMEOUT_MS = 15_000;

export type AddressLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family?: number }>>;

export interface SafeRemoteImageDownload {
  bytes: Buffer;
  contentType: string | null;
}

export type PinnedImageTransport = (input: {
  url: URL;
  address: string;
  family: 4 | 6;
  maxBytes: number;
  timeoutMs: number;
}) => Promise<SafeRemoteImageDownload>;

export function detectSafeRasterContentType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  throw new Error("Remote image is not a supported raster file.");
}

function publicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  ) {
    return false;
  }
  return true;
}

export function isPublicIpAddress(raw: string) {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.startsWith("::ffff:")) return isPublicIpAddress(address.slice(7));
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6) return false;
  return !(
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/u.test(address) ||
    address.startsWith("ff") ||
    address.startsWith("2001:db8")
  );
}

export function assertSafeRemoteImageUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Remote image URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    parsed.hostname.toLowerCase().endsWith(".local")
  ) {
    throw new Error("Remote image URL must use public HTTPS.");
  }
  return parsed;
}

export async function resolvePublicImageAddresses(
  hostname: string,
  lookupImpl: AddressLookup = async (host) =>
    lookup(host, { all: true, verbatim: true }),
) {
  const addresses = await lookupImpl(hostname);
  if (addresses.length === 0 || addresses.some((item) => !isPublicIpAddress(item.address))) {
    throw new Error("Remote image host did not resolve exclusively to public addresses.");
  }
  return addresses.map((item) => ({
    address: item.address,
    family: (item.family === 6 || item.address.includes(":") ? 6 : 4) as 4 | 6,
  }));
}

function pinnedHttpsDownload(input: Parameters<PinnedImageTransport>[0]) {
  return new Promise<SafeRemoteImageDownload>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: SafeRemoteImageDownload) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const request = https.get(
      input.url,
      {
        family: input.family,
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address, input.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (status < 200 || status >= 300) {
          response.resume();
          finish(new Error(
            status >= 300 && status < 400
              ? "Remote image redirects are not allowed."
              : `Remote image download failed: ${status}`,
          ));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > input.maxBytes) {
          response.resume();
          finish(new Error("Remote image exceeds the maximum file size."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxBytes) {
            request.destroy();
            finish(new Error("Remote image exceeds the maximum file size."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => finish(undefined, {
          bytes: Buffer.concat(chunks),
          contentType: response.headers["content-type"] ?? null,
        }));
        response.on("error", (error) => finish(error));
      },
    );
    request.setTimeout(input.timeoutMs, () => {
      request.destroy();
      finish(new Error("Remote image download timed out."));
    });
    request.on("error", (error) => finish(error));
  });
}

export async function downloadSafeRemoteImage(input: {
  url: string;
  lookupImpl?: AddressLookup;
  transport?: PinnedImageTransport;
  maxBytes?: number;
  timeoutMs?: number;
}) {
  const url = assertSafeRemoteImageUrl(input.url);
  const addresses = await resolvePublicImageAddresses(url.hostname, input.lookupImpl);
  const target = addresses[0];
  if (!target) throw new Error("Remote image host did not resolve.");
  const downloaded = await (input.transport ?? pinnedHttpsDownload)({
    url,
    address: target.address,
    family: target.family,
    maxBytes: input.maxBytes ?? IMAGE_CONSTRAINTS.maxFileSizeBytes,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  return {
    bytes: downloaded.bytes,
    contentType: detectSafeRasterContentType(downloaded.bytes),
  };
}
