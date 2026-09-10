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
