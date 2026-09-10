import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { uniqueImageUrls } from "../dealer-stock-sync/image-urls";
import { resolveMaybeUrl } from "./normalize";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function isClassicListRequest(url: string) {
  return url.includes("stock-listing/get-items");
}

export function isVueListRequest(url: string, body: string | null) {
  return url.includes("vehicle-search") && Boolean(body?.includes("getAll"));
}

export function withPageQuery(url: string, page: number) {
  const next = new URL(url);
  next.searchParams.set("page", String(page));
  return next.toString();
}

export function transitUsedVansUrl(startUrl: string) {
  return new URL("/transit-centre/used-vans/", startUrl).toString();
}

export function extractGalleryFromHtml(html: string, origin?: string | null) {
  const found: string[] = [];
  const patterns = [
    /https:\/\/images\.netdirector\.auto\/[A-Za-z0-9_\-+=]+/g,
    /https?:\/\/s3-[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
    /\/\/s3-[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
  ];
  for (const pattern of patterns) {
    const matches = html.match(pattern) ?? [];
    found.push(...matches);
  }

  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) found.push(og[1]);

  return uniqueImageUrls(
    found
      .map((url) => resolveMaybeUrl(url, origin))
      .filter((url): url is string => Boolean(url)),
    FEATURED_LISTING_PHOTO_LIMIT,
  );
}

export function extractDescriptionFromHtml(html: string) {
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldBlocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(json) as { description?: string; "@graph"?: Array<{ description?: string }> };
      const graph = parsed["@graph"] ?? [];
      const fromGraph = graph.find((item) => item.description)?.description;
      const description = parsed.description ?? fromGraph;
      if (description && description.trim().length >= 20) return description.trim();
    } catch {
      // ignore invalid JSON-LD
    }
  }
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
  return meta?.[1]?.trim() ?? "";
}

export async function fetchClassicVehicleDetail(input: {
  detailUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.detailUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": BROWSER_UA,
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const origin = new URL(input.detailUrl).origin;
  return {
    imageUrls: extractGalleryFromHtml(html, origin),
    description: extractDescriptionFromHtml(html),
  };
}
