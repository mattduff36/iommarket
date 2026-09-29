import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { uniqueImageUrls } from "./image-urls";
import { normalizeImageUrl, resolveMaybeUrl } from "./json";

export function isIgnoredImageUrl(url: string) {
  const lower = url.toLowerCase();
  return (
    lower.includes("logo") ||
    lower.includes("pixel") ||
    lower.includes("sprite") ||
    lower.includes("favicon") ||
    lower.includes("placeholder") ||
    lower.includes("noimage") ||
    lower.includes("error.png") ||
    lower.includes("apple-touch-icon") ||
    lower.includes("android-chrome") ||
    lower.includes("/images/brands/") ||
    lower.includes("_default_upload_bucket") ||
    lower.includes("banner") ||
    lower.includes("1x1") ||
    lower.endsWith(".svg") ||
    lower.includes("tracking")
  );
}

export function extractGalleryFromHtml(html: string, origin?: string | null) {
  const found: string[] = [];
  const patterns = [
    /https:\/\/images\.netdirector\.auto\/[A-Za-z0-9_\-+=]+/g,
    /https?:\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
    /\/\/[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
  ];
  for (const pattern of patterns) {
    found.push(...(html.match(pattern) ?? []));
  }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) found.push(og[1]);

  const resolved = found
    .map((raw) => resolveMaybeUrl(raw, origin) ?? normalizeImageUrl(raw))
    .filter((url): url is string => Boolean(url))
    .filter((url) => !isIgnoredImageUrl(url));
  return uniqueImageUrls(resolved, FEATURED_LISTING_PHOTO_LIMIT);
}

function decodeImageAttribute(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function extractSwiftGalleryFromHtml(html: string, origin?: string | null) {
  const gallery = html.match(/<bsk-gallery\b[^>]*\bimages=["']([^"']+)["']/i)?.[1];
  if (!gallery) return [];

  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
  const fallbackBase = "https://bluesky.cdn.imgeng.in/cogstock-images/";
  let galleryBase = fallbackBase;
  try {
    if (og) galleryBase = new URL(".", decodeImageAttribute(og)).toString();
    else if (origin) galleryBase = new URL("/cogstock-images/", origin).toString();
  } catch {
    galleryBase = fallbackBase;
  }

  const resolved = decodeImageAttribute(gallery)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value, galleryBase).toString();
      } catch {
        return resolveMaybeUrl(value, galleryBase) ?? normalizeImageUrl(value);
      }
    })
    .filter((url): url is string => Boolean(url))
    .filter((url) => !isIgnoredImageUrl(url));

  return uniqueImageUrls(resolved, FEATURED_LISTING_PHOTO_LIMIT);
}

export function extractDescriptionFromHtml(html: string) {
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldBlocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(json) as {
        description?: string;
        "@graph"?: Array<{ description?: string }>;
      };
      const fromGraph = (parsed["@graph"] ?? []).find((item) => item.description)?.description;
      const description = parsed.description ?? fromGraph;
      if (description && description.trim().length >= 20) return description.trim();
    } catch {
      // ignore invalid JSON-LD
    }
  }
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
  return meta?.[1]?.trim() ?? "";
}
