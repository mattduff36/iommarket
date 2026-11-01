import { checkRateLimit } from "@/lib/rate-limit";
import { captureBusinessEvent } from "./capture";
import { monitoringAppUrl } from "./alert-message";

const IMAGE_HOSTS = new Set(["ik.imagekit.io", "res.cloudinary.com"]);
const SITE_HOSTS = new Set(["itrader.im", "www.itrader.im"]);

async function limitedText(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error("home-unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > 2_000_000) throw new Error("home-too-large");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel(); }
}

/** Exercise an anonymous listing photo, including its redirect and actual image body. */
export async function probePublicImage(origin: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const site = new URL(origin);
    if (site.protocol !== "https:" || !SITE_HOSTS.has(site.hostname) || site.port || site.username || site.password) return false;
    const signal = AbortSignal.timeout(12_000);
    const options = { cache: "no-store" as const, redirect: "manual" as const, signal };
    const html = await limitedText(await fetchImpl(new URL("/", site), options));
    const path = html.match(/\/api\/media\/listing-photo\?[^"<>\s\\]+/)?.[0]?.replaceAll("&amp;", "&");
    if (!path) return false;
    let target = new URL(path, site);
    target.searchParams.set("w", "320");
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (target.protocol !== "https:" || target.port || target.username || target.password ||
        (target.origin !== site.origin && !IMAGE_HOSTS.has(target.hostname))) return false;
      const response = await fetchImpl(target, options);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        target = new URL(location, target);
        continue;
      }
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/") || !response.body) {
        await response.body?.cancel();
        return false;
      }
      const reader = response.body.getReader();
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
  } catch { return false; }
  return false;
}

export async function runMediaHealthCheck() {
  // Vercel cron runs in production; never let a preview probe the production site.
  if (process.env.VERCEL_ENV !== "production") return { status: "skipped" as const };
  const [rate, image] = await Promise.all([
    checkRateLimit("health", { policy: "media-health", windowMs: 60_000, maxRequests: 60 }),
    probePublicImage(monitoringAppUrl()),
  ]);
  if (rate.unavailable || !image) {
    await captureBusinessEvent({
      source: "BUSINESS", severity: "HIGH", title: "Website image service needs attention",
      message: "The scheduled image or rate-limit service check failed. Check image delivery and the Upstash quota or connection.",
      action: "mediaHealthCheck", dedupeKey: "media-health", route: "/api/media/listing-photo",
      tags: { imageAvailable: image, rateLimitAvailable: !rate.unavailable },
    });
  }
  return { status: image && !rate.unavailable ? "healthy" as const : "degraded" as const, imageAvailable: image, rateLimitAvailable: !rate.unavailable };
}
