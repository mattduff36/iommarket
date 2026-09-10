import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";

const AUTOFS_NDSTOCK = "://s3-eu-west-1.amazonaws.com/autofs/ndstock/";
const IRELAND_NDSTOCK = "://s3-eu-west-1.amazonaws.com/nd-stock-ireland-production/ndstock/";
const NETDIRECTOR_HOST = "images.netdirector.auto";
const WORDPRESS_SIZE = /-(\d+)x(\d+)(?:-\d+)?(\.(jpe?g|png|webp))$/i;
const WORDPRESS_SCALED = /-scaled(\.(jpe?g|png|webp))$/i;
const DRAGON_SIZE = /-(mini|medium|large|thumb|small)(\.(jpe?g|png|webp))$/i;
const SMG_SIZE_DIR = /(\/images\/\d+\/)(\d+)(\/)/i;
const CD5_WIDTH_DIR = /\/w(\d+)\//i;
const THUMB_DIR = /\/thumb\//i;
const FILENAME_T_PREFIX = /(^|\/)t_([^/]+)$/i;
const IMGENG_WIDTH = /imgeng=\/w_(\d+)/i;
const UUID_FILE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$/i;
const DRAGON_SCORE: Record<string, number> = {
  large: 1_200,
  medium: 800,
  small: 400,
  thumb: 240,
  mini: 200,
};
const S3_ORIGINAL_BONUS = 100_000;
const ORIGINAL_SCORE = 2_000_000;
const CDN_ORIGINAL_SCORE = 1_500_000;
const THUMB_DIR_SCORE = 400;
const T_PREFIX_SCORE = 300;

export interface NetDirectorImageToken {
  key?: string;
  edits?: {
    resize?: { width?: number; height?: number; fit?: string };
    [extra: string]: unknown;
  };
  [extra: string]: unknown;
}

export function rewriteNdstockUrl(url: string) {
  return url.replace(AUTOFS_NDSTOCK, IRELAND_NDSTOCK);
}

export function encodeNetDirectorImageUrl(payload: NetDirectorImageToken) {
  const token = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `https://${NETDIRECTOR_HOST}/${token}`;
}

export function parseNetDirectorImageToken(url: string): NetDirectorImageToken | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.startsWith("//") ? `https:${url}` : url);
  } catch {
    return null;
  }
  if (parsedUrl.hostname.toLowerCase() !== NETDIRECTOR_HOST) return null;
  const token = parsedUrl.pathname.split("/").filter(Boolean).pop();
  if (!token) return null;
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const decoded = Buffer.from(`${padded}${pad}`, "base64").toString("utf8");
    const payload = JSON.parse(decoded) as NetDirectorImageToken;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function normalizeHttpImageUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

function pathnameOf(url: string) {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function hostAndPathOf(url: string) {
  try {
    const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function stripWordpressSize(path: string) {
  return path
    .replace(WORDPRESS_SIZE, "$3")
    .replace(WORDPRESS_SCALED, "$1");
}

function stripSizeVariantPath(path: string) {
  return stripWordpressSize(path)
    .replace(DRAGON_SIZE, "$2")
    .replace(SMG_SIZE_DIR, "$1")
    .replace(CD5_WIDTH_DIR, "/")
    .replace(THUMB_DIR, "/")
    .replace(FILENAME_T_PREFIX, "$1$2")
    .replace(UUID_FILE, (match) => match.replace(/\.(jpe?g|png|webp)$/i, ""));
}

function ndstockKeyFromPath(path: string) {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  const marker = "/ndstock/";
  const index = lower.indexOf(marker);
  if (index >= 0) return `ndstock/${lower.slice(index + marker.length)}`;
  if (lower.startsWith("ndstock/")) return lower;
  return null;
}

export function imageIdentityKey(url: string) {
  const token = parseNetDirectorImageToken(url);
  if (token?.key) {
    const fromKey = ndstockKeyFromPath(`/${token.key}`) ?? token.key.replace(/\\/g, "/").toLowerCase().replace(/^\/+/, "");
    return stripSizeVariantPath(fromKey);
  }
  const path = pathnameOf(url);
  const ndstock = ndstockKeyFromPath(path);
  if (ndstock) return stripSizeVariantPath(ndstock);
  return stripSizeVariantPath(hostAndPathOf(url)).toLowerCase();
}

export function imageQualityScore(url: string) {
  const token = parseNetDirectorImageToken(url);
  if (token) {
    const width = token.edits?.resize?.width;
    if (typeof width === "number" && Number.isFinite(width) && width > 0) return width;
    return CDN_ORIGINAL_SCORE;
  }
  const path = pathnameOf(url);
  const wordpress = path.match(WORDPRESS_SIZE);
  if (wordpress) return Number(wordpress[1]);
  const imgeng = url.match(IMGENG_WIDTH);
  if (imgeng) return Number(imgeng[1]);
  const smg = path.match(SMG_SIZE_DIR);
  if (smg) return Number(smg[2]);
  const cd5 = path.match(CD5_WIDTH_DIR);
  if (cd5) return Number(cd5[1]);
  const dragon = path.match(DRAGON_SIZE);
  if (dragon) return DRAGON_SCORE[dragon[1].toLowerCase()] ?? 200;
  if (THUMB_DIR.test(path) || FILENAME_T_PREFIX.test(path)) {
    return THUMB_DIR.test(path) ? THUMB_DIR_SCORE : T_PREFIX_SCORE;
  }
  let score = ORIGINAL_SCORE;
  if (WORDPRESS_SCALED.test(path)) score -= 10;
  if (/amazonaws\.com/i.test(url) || ndstockKeyFromPath(path)) score += S3_ORIGINAL_BONUS;
  return score;
}

export function canonicalizeImageUrl(url: string) {
  const rewritten = rewriteNdstockUrl(url);
  const token = parseNetDirectorImageToken(rewritten);
  if (!token) return rewritten;
  if (!token.edits || token.edits.resize == null) return rewritten;
  const { resize: _resize, ...restEdits } = token.edits;
  const next: NetDirectorImageToken = { ...token };
  if (Object.keys(restEdits).length > 0) {
    next.edits = restEdits;
  } else {
    delete next.edits;
  }
  return encodeNetDirectorImageUrl(next);
}

export function pickRecordImageUrl(record: Record<string, unknown> | null | undefined) {
  if (!record) return null;
  for (const key of ["original", "large", "url", "src"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function uniqueImageUrls(urls: string[], max = FEATURED_LISTING_PHOTO_LIMIT) {
  const best = new Map<string, { url: string; score: number }>();
  const order: string[] = [];
  for (const raw of urls) {
    const url = normalizeHttpImageUrl(raw);
    if (!url) continue;
    const identity = imageIdentityKey(url);
    const score = imageQualityScore(url);
    const existing = best.get(identity);
    if (!existing) {
      best.set(identity, { url, score });
      order.push(identity);
      continue;
    }
    if (score > existing.score) best.set(identity, { url, score });
  }
  return order.slice(0, max).map((identity) => canonicalizeImageUrl(best.get(identity)!.url));
}

export function uniqueImageSources<T extends { url: string }>(sources: T[], max: number) {
  const preferred = uniqueImageUrls(
    sources.map((source) => source.url),
    max,
  );
  const byIdentity = new Map<string, T>();
  for (const source of sources) {
    const url = normalizeHttpImageUrl(source.url);
    if (!url) continue;
    const identity = imageIdentityKey(url);
    const existing = byIdentity.get(identity);
    if (!existing || imageQualityScore(url) > imageQualityScore(existing.url)) {
      byIdentity.set(identity, source);
    }
  }
  return preferred
    .map((url) => {
      const source = byIdentity.get(imageIdentityKey(url));
      if (!source) return null;
      return { ...source, url };
    })
    .filter((source): source is T => source !== null);
}
