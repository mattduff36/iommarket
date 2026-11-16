/** Server-only media evidence. Never expose raw identities, URLs or client identifiers. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { listingPhotoDeliveryQuerySchema } from "./listing-photo-query";

export const MEDIA_DENIAL_SOURCES = ["shared-window", "local-window", "bucket-cap"] as const;
export type MediaDenialSource = typeof MEDIA_DENIAL_SOURCES[number];
const mediaFactsSchema = z.object({
  route: z.enum(["/api/media/listing-photo", "/api/media/cloudinary-ref"]),
  assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(["listing", "revision", "upload"]).optional(),
  mode: z.enum(["fill", "fit", "blur", "social"]).optional(),
  frame: z.enum(["card", "gallery", "thumb", "admin", "preview", "social"]).optional(),
  width: listingPhotoDeliveryQuerySchema.shape.w.optional(),
});
export type MediaRequestFacts = z.infer<typeof mediaFactsSchema>;

export function safeMediaFacts(value: unknown): MediaRequestFacts | undefined {
  const parsed = mediaFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function fingerprint(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(["media-v1", ...parts])).digest("hex");
}

export function mediaRequestFacts(path: string): MediaRequestFacts | undefined {
  try {
    if (path.length > 8000 || !path.startsWith("/") || path.startsWith("//")) return;
    const url = new URL(path, "https://media.invalid");
    if (url.origin !== "https://media.invalid") return;
    if (url.pathname === "/api/media/listing-photo") {
      const parsed = listingPhotoDeliveryQuerySchema.safeParse({
        imageId: url.searchParams.get("imageId"), source: url.searchParams.get("source") ?? undefined,
        mode: url.searchParams.get("mode"), frame: url.searchParams.get("frame"), w: url.searchParams.get("w"),
      });
      if (!parsed.success || !/^[A-Za-z0-9_-]{1,80}$/.test(parsed.data.imageId)) return;
      const { imageId, source, mode, frame, w } = parsed.data;
      return { route: url.pathname, assetFingerprint: fingerprint(["listing-photo", source, imageId]), source, mode, frame, width: w };
    }
    if (url.pathname !== "/api/media/cloudinary-ref") return;
    const raw = url.searchParams.get("url");
    if (!raw || raw.length > 2000) return;
    const logo = new URL(raw);
    if (logo.protocol !== "https:" || logo.host !== "res.cloudinary.com" || logo.username || logo.password) return;
    // The DB lookup uses this exact raw reference. Hash all of it; never log it.
    return { route: url.pathname, assetFingerprint: fingerprint(["cloudinary-ref", raw]) };
  } catch { return; } // Evidence collection must not change request behavior.
}

type DenialInput = {
  path: string; denialSource?: string; retryAfterSeconds: number;
  requestId?: string | null; release?: string;
};

/** At most 20 asset/source pairs per process per minute, not a distributed counter. */
export function createMediaDenialReporter(now: () => number = Date.now, warn: (message: string) => void = console.warn) {
  const seen = new Set<string>();
  let windowStartedAt: number | undefined;
  return (input: DenialInput): void => {
    try {
      const facts = mediaRequestFacts(input.path);
      const denialSource = MEDIA_DENIAL_SOURCES.find(value => value === input.denialSource);
      if (!facts || !denialSource) return;
      const time = now();
      if (!Number.isFinite(time)) return;
      if (windowStartedAt === undefined || time < windowStartedAt || time - windowStartedAt >= 60_000) {
        seen.clear();windowStartedAt = time;
      }
      const key = `${facts.assetFingerprint}:${denialSource}`;
      if (seen.has(key) || seen.size >= 20) return;
      seen.add(key);
      const retry = input.retryAfterSeconds;
      warn(JSON.stringify({
        kind: "media-read-denied", status: 429, ...facts, denialSource,
        ...(Number.isInteger(retry) && retry >= 1 && retry <= 86_400 ? { retryAfterSeconds: retry } : {}),
        ...(typeof input.requestId === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(input.requestId) ? { requestId: input.requestId } : {}),
        ...(typeof input.release === "string" && /^[a-f0-9]{40}$/i.test(input.release) ? { release: input.release } : {}),
      }));
    } catch { /* Logging failures must not change the rate-limit response. */ }
  };
}

export const reportMediaDenial = createMediaDenialReporter();
