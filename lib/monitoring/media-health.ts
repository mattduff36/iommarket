import { checkRateLimit } from "@/lib/rate-limit";
import { captureBusinessEvent } from "./capture";
import { monitoringAppUrl } from "./alert-message";

const IMAGE_HOSTS = new Set(["ik.imagekit.io", "res.cloudinary.com"]);
const SITE_HOSTS = new Set(["itrader.im", "www.itrader.im"]);

type ImageProbePhase = "origin" | "homepage" | "listing-photo" | "redirect" | "provider" | "image-body";
type ImageProbeReason = "ok" | "invalid-origin" | "http-status" | "missing-body" |
  "homepage-too-large" | "photo-not-found" | "unsafe-redirect" | "invalid-redirect" |
  "redirect-limit" | "invalid-content-type" | "invalid-image-body" | "request-failed" |
  "body-read-failed" | "timeout";
interface ImageProbeResult {
  available: boolean;
  phase: ImageProbePhase;
  reason: ImageProbeReason;
  httpStatus?: number;
}

async function limitedText(body: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > 2_000_000) return null;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel(); }
}

async function isImageBody(body: ReadableStream<Uint8Array>): Promise<boolean> {
  const reader = body.getReader();
  try {
    const { value } = await reader.read();
    if (!value || value.length < 12) return false;
    const ascii = new TextDecoder().decode(value.slice(0, 16));
    return (value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) ||
      (value[0] === 0x89 && ascii.slice(1, 4) === "PNG") ||
      ascii.startsWith("GIF8") || (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") ||
      (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8)));
  } finally { await reader.cancel(); }
}

async function probePublicImageResult(origin: string, fetchImpl: typeof fetch = fetch): Promise<ImageProbeResult> {
  let phase: ImageProbePhase = "origin";
  let reason: ImageProbeReason = "invalid-origin";
  let httpStatus: number | undefined;
  const result = (available: boolean, outcome: ImageProbeReason): ImageProbeResult => ({
    available, phase, reason: outcome, ...(httpStatus === undefined ? {} : { httpStatus }),
  });
  const recordStatus = (response: Response) => {
    httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? response.status : undefined;
  };
  try {
    const site = new URL(origin);
    if (site.protocol !== "https:" || !SITE_HOSTS.has(site.hostname) || site.port || site.username || site.password) return result(false, "invalid-origin");
    const signal = AbortSignal.timeout(12_000);
    const options = { cache: "no-store" as const, redirect: "manual" as const, signal };
    phase = "homepage";
    reason = "request-failed";
    const homepage = await fetchImpl(new URL("/", site), options);
    recordStatus(homepage);
    if (!homepage.ok || !homepage.body) {
      await homepage.body?.cancel();
      return result(false, homepage.ok ? "missing-body" : "http-status");
    }
    reason = "body-read-failed";
    const html = await limitedText(homepage.body);
    if (html === null) return result(false, "homepage-too-large");
    const path = html.match(/\/api\/media\/listing-photo\?[^"<>\s\\]+/)?.[0]?.replaceAll("&amp;", "&");
    if (!path) return result(false, "photo-not-found");
    let target = new URL(path, site);
    target.searchParams.set("w", "320");
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (target.protocol !== "https:" || target.port || target.username || target.password ||
        (target.origin !== site.origin && !IMAGE_HOSTS.has(target.hostname))) return result(false, "unsafe-redirect");
      phase = target.origin === site.origin ? "listing-photo" : "provider";
      reason = "request-failed";
      httpStatus = undefined;
      const response = await fetchImpl(target, options);
      recordStatus(response);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400) {
        phase = "redirect";
        reason = "invalid-redirect";
        await response.body?.cancel();
        if (!location) return result(false, "invalid-redirect");
        if (redirects === 3) return result(false, "redirect-limit");
        target = new URL(location, target);
        continue;
      }
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/") || !response.body) {
        await response.body?.cancel();
        return result(false, !response.ok ? "http-status" : !response.body ? "missing-body" : "invalid-content-type");
      }
      phase = "image-body";
      reason = "body-read-failed";
      const available = await isImageBody(response.body);
      return result(available, available ? "ok" : "invalid-image-body");
    }
  } catch (error) {
    return result(false, error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "timeout" : reason);
  }
  return result(false, "redirect-limit");
}

/** Exercise an anonymous listing photo, including its redirect and actual image body. */
export async function probePublicImage(origin: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return (await probePublicImageResult(origin, fetchImpl)).available;
}

export async function runMediaHealthCheck() {
  // Vercel cron runs in production; never let a preview probe the production site.
  if (process.env.VERCEL_ENV !== "production") return { status: "skipped" as const };
  const [rate, imageProbe] = await Promise.all([
    checkRateLimit("health", { policy: "media-health", windowMs: 60_000, maxRequests: 60 }),
    probePublicImageResult(monitoringAppUrl()),
  ]);
  const image = imageProbe.available;
  if (rate.unavailable || !image) {
    await captureBusinessEvent({
      source: "BUSINESS", severity: "HIGH", title: "Website image service needs attention",
      message: "The scheduled image or rate-limit service check failed. Check image delivery and the Upstash quota or connection.",
      action: "mediaHealthCheck", dedupeKey: `media-health:${new Date().toISOString().slice(0, 10)}`, route: "/api/media/listing-photo",
      tags: {
        imageAvailable: image, rateLimitAvailable: !rate.unavailable,
        imageProbePhase: imageProbe.phase, imageProbeReason: imageProbe.reason,
        ...(imageProbe.httpStatus === undefined ? {} : { imageProbeHttpStatus: imageProbe.httpStatus }),
      },
    });
  }
  return { status: image && !rate.unavailable ? "healthy" as const : "degraded" as const, imageAvailable: image, rateLimitAvailable: !rate.unavailable };
}
