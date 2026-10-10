import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { parseNextData } from "./connectors/html-extract";
import {
  isIgnoredImageUrl,
  mergeOwnerImageUrls,
  pickRecordImageUrl,
  uniqueImageUrls,
} from "./image-urls";
import { asRecord, asString, normalizeImageUrl, resolveMaybeUrl } from "./json";

export { isIgnoredImageUrl, mergeOwnerImageUrls };

const RELATED_NODE_KEYS = new Set([
  "related",
  "relatedvehicles",
  "relatedstock",
  "similar",
  "similarvehicles",
  "recommendations",
  "morevehicles",
  "alsoviewed",
  "recentlyviewed",
  "suggestions",
  "otherstock",
]);

const PAGE_OWNER_KEYS = [
  "vehicle",
  "listing",
  "inventoryitem",
  "inventoryvehicle",
  "currentvehicle",
  "pagevehicle",
  "selectedvehicle",
];

export function isNextInventoryDetailUrl(detailUrl?: string | null) {
  if (!detailUrl) return false;
  try {
    return /\/inventory\//i.test(new URL(detailUrl).pathname);
  } catch {
    return /\/inventory\//i.test(detailUrl);
  }
}

function lastInventorySegment(value: string) {
  try {
    const path = value.includes("://") ? new URL(value).pathname : value;
    return (
      path
        .split("/")
        .filter((segment) => segment && segment.toLowerCase() !== "inventory")
        .at(-1)
        ?.toLowerCase() ?? ""
    );
  } catch {
    return value.toLowerCase();
  }
}

function recordImageFields(record: Record<string, unknown>) {
  return Boolean(
    record.image ||
      record.imageUrl ||
      record.mainImage ||
      record.images ||
      record.photos ||
      record.gallery ||
      record.listingImages,
  );
}

function recordIdentityHaystack(record: Record<string, unknown>) {
  return [
    asString(record.slug),
    asString(record.url),
    asString(record.href),
    asString(record.id),
    asString(record.uuid),
    asString(record.stockId),
    asString(record.externalUrl),
    asString(record.detailUrl),
    asString(record.path),
    asString(asRecord(record.url)?.pathname),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function recordMatchesDetail(record: Record<string, unknown>, detailUrl?: string | null) {
  if (!detailUrl) return false;
  const target = lastInventorySegment(detailUrl);
  if (target.length < 6) return false;
  return recordIdentityHaystack(record).includes(target);
}

function collectRecordImages(record: Record<string, unknown>, origin?: string | null) {
  const found: string[] = [];
  for (const key of ["image", "imageUrl", "mainImage", "thumbnail", "ogImage"] as const) {
    const field = record[key];
    if (Array.isArray(field)) {
      for (const item of field) {
        if (typeof item === "string") found.push(item);
        const nestedUrl = pickRecordImageUrl(asRecord(item));
        if (nestedUrl) found.push(nestedUrl);
      }
      continue;
    }
    const value = asString(field) ?? asString(asRecord(field)?.url);
    if (value) found.push(value);
  }
  for (const key of ["images", "photos", "gallery", "listingImages", "media"] as const) {
    const collection = record[key];
    const items = Array.isArray(collection)
      ? collection
      : Array.isArray(asRecord(collection)?.images)
        ? (asRecord(collection)?.images as unknown[])
        : [];
    for (const item of items) {
      if (typeof item === "string") found.push(item);
      const url = pickRecordImageUrl(asRecord(item));
      if (url) found.push(url);
    }
  }
  return uniqueImageUrls(
    found
      .map((value) => resolveMaybeUrl(value, origin) ?? normalizeImageUrl(value))
      .filter((url): url is string => Boolean(url)),
    FEATURED_LISTING_PHOTO_LIMIT,
  );
}

function walkNextOwnerRecords(
  node: unknown,
  detailUrl: string | null | undefined,
  depth = 0,
  matches: Record<string, unknown>[] = [],
) {
  if (depth > 10 || node == null) return matches;
  if (Array.isArray(node)) {
    for (const item of node) walkNextOwnerRecords(item, detailUrl, depth + 1, matches);
    return matches;
  }
  const record = asRecord(node);
  if (!record) return matches;
  if (recordImageFields(record) && recordMatchesDetail(record, detailUrl)) {
    matches.push(record);
    return matches;
  }
  for (const [key, value] of Object.entries(record)) {
    if (RELATED_NODE_KEYS.has(key.toLowerCase())) continue;
    walkNextOwnerRecords(value, detailUrl, depth + 1, matches);
  }
  return matches;
}

function pageOwnerRecord(data: unknown, detailUrl?: string | null) {
  const root = asRecord(data);
  const pageProps = asRecord(asRecord(root?.props)?.pageProps) ?? root;
  if (pageProps) {
    for (const key of PAGE_OWNER_KEYS) {
      const record = asRecord(pageProps[key]);
      if (!record || !recordImageFields(record)) continue;
      if (!detailUrl || recordMatchesDetail(record, detailUrl)) return record;
    }
  }
  const matches = walkNextOwnerRecords(data, detailUrl);
  if (matches.length === 1) return matches[0]!;
  if (!detailUrl) return null;
  const target = lastInventorySegment(detailUrl);
  const exact = matches.filter(
    (record) => lastInventorySegment(recordIdentityHaystack(record)) === target,
  );
  return exact.length === 1 ? exact[0]! : null;
}

export function extractNextInventoryGalleryFromHtml(
  html: string,
  origin?: string | null,
  detailUrl?: string | null,
) {
  const data = parseNextData(html);
  if (data == null) return [];
  const owner = pageOwnerRecord(data, detailUrl);
  return owner ? collectRecordImages(owner, origin) : [];
}

function extractJsonLdVehicleImages(html: string, origin?: string | null) {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(json) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        const graph = asRecord(record)?.["@graph"];
        const items = Array.isArray(graph) ? graph : [record];
        for (const item of items) {
          const typed = asRecord(item);
          const type = asString(typed?.["@type"]) ?? "";
          if (!typed || !/car|vehicle|product/i.test(type)) continue;
          const images = collectRecordImages(typed, origin);
          if (images.length > 0) return images;
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return [];
}

function ownerHtmlFragment(html: string) {
  const cut = html.search(
    /<(?:h[1-6]|section|div)[^>]*>[\s\S]{0,120}(?:similar vehicles|related vehicles|more like this|you may also|other vehicles)/i,
  );
  return cut >= 0 ? html.slice(0, cut) : html;
}

function extractNetDirectorUrls(html: string, origin?: string | null) {
  const found: string[] = [];
  const patterns = [
    /https:\/\/images\.netdirector\.auto\/[A-Za-z0-9_\-+=]+/g,
    /https?:\/\/s3-[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
    /\/\/s3-[^"'\s>]+\.(?:jpe?g|png|webp)/gi,
  ];
  for (const pattern of patterns) {
    found.push(...(html.match(pattern) ?? []));
  }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) found.push(og[1]);
  return uniqueImageUrls(
    found
      .map((raw) => resolveMaybeUrl(raw, origin) ?? normalizeImageUrl(raw))
      .filter((url): url is string => Boolean(url)),
    FEATURED_LISTING_PHOTO_LIMIT,
  );
}

export function extractNetDirectorGalleryFromHtml(html: string, origin?: string | null) {
  const fromLd = extractJsonLdVehicleImages(html, origin);
  if (fromLd.length > 1) return fromLd;
  const scoped = extractNetDirectorUrls(ownerHtmlFragment(html), origin);
  if (scoped.length > 0) return scoped;
  return fromLd;
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

function extractImageAttributes(
  html: string,
  origin: string | null,
  accepts: (value: string) => boolean,
) {
  const found: string[] = [];
  const attributes =
    html.matchAll(/\b(?:src|data-src|data-lazy-src|href)=["']([^"']+)["']/gi);
  for (const match of attributes) {
    const raw = decodeImageAttribute(match[1] ?? "").trim();
    if (!raw || !accepts(raw)) continue;
    const resolved = resolveMaybeUrl(raw, origin) ?? normalizeImageUrl(raw);
    if (resolved) found.push(resolved);
  }
  return uniqueImageUrls(found, FEATURED_LISTING_PHOTO_LIMIT);
}

export function extractBccGalleryFromHtml(html: string, origin: string | null) {
  return extractImageAttributes(
    ownerHtmlFragment(html),
    origin,
    (value) => /\/media\/images\/\d+\/p0\.[^"'?\s>]+\.(?:jpe?g|png|webp)(?:[?&#]|$)/i.test(value),
  );
}

export function extractSelectCarSalesGalleryFromHtml(
  html: string,
  origin: string | null,
) {
  return extractImageAttributes(
    ownerHtmlFragment(html),
    origin,
    (value) => /\/Home\/Image\/\d+(?:[?&#]|$)/i.test(value),
  );
}

function franklinDetailStockId(detailUrl?: string | null) {
  if (!detailUrl) return null;
  let pathname = detailUrl;
  try {
    pathname = new URL(detailUrl).pathname;
  } catch {
    pathname = detailUrl.split("?")[0] ?? detailUrl;
  }
  return pathname.match(/\/(?:cars|vans)\/(?:[^/]+\/)*(\d+)\/?$/i)?.[1] ?? null;
}

function isFranklinStockImage(value: string, stockId: string) {
  try {
    const url = new URL(value, "https://www.franklins.co.im");
    const host = url.hostname.toLowerCase();
    if (host !== "cd5.uk" && !host.endsWith(".cd5.uk")) return false;
    return new RegExp(
      `/stockimages/${stockId}/(?:w\\d+/)?[^/]+\\.(?:jpe?g|png|webp)$`,
      "i",
    ).test(url.pathname);
  } catch {
    return false;
  }
}

export function extractFranklinGalleryFromHtml(
  html: string,
  origin: string | null,
  detailUrl?: string | null,
) {
  const stockId = franklinDetailStockId(detailUrl);
  if (!stockId) return [];
  return extractImageAttributes(html, origin, (value) => isFranklinStockImage(value, stockId));
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

export function extractWebsiteDetailImages(
  html: string,
  origin: string | null,
  options: { dealerKey?: string; detailUrl?: string | null } = {},
) {
  if (options.dealerKey === "mikes-motors") {
    const id = options.detailUrl?.match(/-(\d+)\/?$/)?.[1];
    if (!id) return [];
    const urls = html.match(/https:\/\/images\.clickdealer\.co\.uk\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi) ?? [];
    return uniqueImageUrls(urls.filter(url => new URL(url).pathname.includes(`/${id}/full/`)), FEATURED_LISTING_PHOTO_LIMIT);
  }
  if (options.dealerKey === "bcc-cars") {
    return extractBccGalleryFromHtml(html, origin);
  }
  if (options.dealerKey === "select-car-sales") {
    return extractSelectCarSalesGalleryFromHtml(html, origin);
  }
  if (options.dealerKey === "swift-motors") {
    return extractSwiftGalleryFromHtml(html, origin);
  }
  if (options.dealerKey === "franklins") {
    return extractFranklinGalleryFromHtml(html, origin, options.detailUrl);
  }
  if (isNextInventoryDetailUrl(options.detailUrl) && html.includes("__NEXT_DATA__")) {
    return extractNextInventoryGalleryFromHtml(html, origin, options.detailUrl);
  }
  return extractGalleryFromHtml(html, origin);
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
