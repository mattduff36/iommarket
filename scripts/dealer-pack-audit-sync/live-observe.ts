import { isIP } from "node:net";
import { isPublicIpAddress } from "../../lib/images/safe-remote-image";
import { ownerTokenMatches } from "../dealer-stock-sync/image-ownership";
import {
  canonicalizeImageUrl,
  imageIdentityKey,
  imageQualityScore,
  normalizeHttpImageUrl,
} from "../dealer-stock-sync/image-urls";
import {
  canonicalizeLiveUrl,
  extractStockIdFromUrl,
  isCardBadgeTitle,
  parsePricePence,
  stockIdCores,
  stockIdsEquivalent,
} from "./live-match";
import type { LiveObservedIdentity, LivePlannedIdentity } from "./live-types";

export type LiveDomRegion =
  | "header"
  | "nav"
  | "footer"
  | "aside"
  | "related"
  | "main"
  | "gallery"
  | "unknown";

export interface VisibleElementSnapshot {
  tag: string;
  href: string | null;
  src: string | null;
  currentSrc: string | null;
  dataSrc?: string | null;
  srcset?: string | null;
  alt: string | null;
  text: string;
  visible: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  region?: LiveDomRegion;
  ownerHref?: string | null;
  imagePath?: string | null;
  ancestorHints?: string[];
}

export interface ObservedStockCard extends LiveObservedIdentity {
  top: number;
  left: number;
}

export interface ObservedDetailGallery {
  heroSrc: string | null;
  gallerySrcs: string[];
  galleryAlts: Array<string | null>;
}

export interface LiveNavigationResult {
  ok: boolean;
  status: number | null;
  url: string;
  title: string;
  error: string | null;
  blocked: boolean;
}

export interface LiveGotoOptions {
  allowedHosts?: readonly string[];
}

export interface LiveBrowserPage {
  goto(url: string, options?: LiveGotoOptions): Promise<LiveNavigationResult>;
  snapshotAnchors(): Promise<VisibleElementSnapshot[]>;
  snapshotImages(): Promise<VisibleElementSnapshot[]>;
  clickVisibleLoadMore(): Promise<boolean>;
  pageText(): Promise<string>;
  screenshot(): Promise<Buffer | null>;
  url(): string;
  close(): Promise<void>;
}

export interface LiveBrowserSession {
  openPage(): Promise<LiveBrowserPage>;
  close(): Promise<void>;
}

export type LiveBrowserFactory = () => Promise<LiveBrowserSession>;

export const MAX_STOCK_LIST_PAGES = 8;
export const MAX_LOAD_MORE_CLICKS = 8;

const MIN_CARD_EDGE = 48;
const MIN_GALLERY_EDGE = 80;
const PRICE = /(?:£|&pound;|GBP)\s*[\d,]{3,8}/gi;
const CHROME_REGIONS = new Set<LiveDomRegion>(["header", "nav", "footer"]);
const RELATED_REGIONS = new Set<LiveDomRegion>(["aside", "related"]);
const GALLERY_REGIONS = new Set<LiveDomRegion>(["main", "gallery"]);
const RELATED_HINT = /related|similar|recommended|also-view|latest-stock|lateststock/;
const GALLERY_HINT = /gallery|swiper|carousel|lightbox|photoswipe/;
const NAV_PATH =
  /\/(about|contact|login|privacy|terms|finance|service|servicing|blog|news|careers)(\/|$)/i;
const STOCK_INDEX_PATH = /\/(used-cars|used|stock|cars|vehicles|inventory|pre-owned)\/?$/i;
const PAGINATION_PATH = /[?&]page=\d+|\/page\/\d+/i;

export interface GalleryScope {
  listingUrl?: string | null;
  stockId?: string | null;
  ownerImagePaths?: string[];
  preferredHeroUrl?: string | null;
}

function uniqueBy<T>(items: T[], key: (item: T) => string | null) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function isBlockedNavigation(input: {
  status: number | null;
  title: string;
  error?: string | null;
}) {
  if (input.status === 401 || input.status === 403) return true;
  const haystack = `${input.title}\n${input.error ?? ""}`.toLowerCase();
  return /captcha|cloudflare|attention required|access denied|just a moment/.test(
    haystack,
  );
}

export function isBlockedLiveHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  return Boolean(isIP(host) && !isPublicIpAddress(host));
}

export function allowedLiveHosts(urls: Array<string | null | undefined>) {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (isBlockedLiveHostname(parsed.hostname)) continue;
      hosts.add(parsed.hostname.toLowerCase());
    } catch {
      continue;
    }
  }
  return [...hosts];
}

export type LiveNavigationInspection =
  | { ok: true; error: null; blocked: false }
  | { ok: false; error: string; blocked: true };

export function inspectLiveNavigation(
  url: string,
  allowedHosts?: readonly string[] | null,
): LiveNavigationInspection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid-url", blocked: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported-protocol", blocked: true };
  }
  if (isBlockedLiveHostname(parsed.hostname)) {
    return { ok: false, error: "private-or-local-host", blocked: true };
  }
  if (
    allowedHosts &&
    !allowedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())
  ) {
    return { ok: false, error: "host-not-allowed", blocked: true };
  }
  return { ok: true, error: null, blocked: false };
}

export function navigationBlocked(
  url: string,
  error: string,
): LiveNavigationResult {
  return {
    ok: false,
    status: null,
    url,
    title: "",
    error,
    blocked: true,
  };
}

export async function gotoAllowed(
  page: LiveBrowserPage,
  url: string,
  allowedHosts: readonly string[],
): Promise<LiveNavigationResult> {
  const requested = inspectLiveNavigation(url, allowedHosts);
  if (!requested.ok) return navigationBlocked(url, requested.error);
  const navigation = await page.goto(url, { allowedHosts });
  const landed = navigation.url || url;
  const inspected = inspectLiveNavigation(landed, allowedHosts);
  if (!inspected.ok) {
    return {
      ...navigation,
      ok: false,
      blocked: true,
      error: inspected.error,
      url: landed,
    };
  }
  return navigation;
}

export function imagePathname(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function ownerImagePathHints(urls: Array<string | null | undefined>) {
  return [...new Set(urls.flatMap((url) => {
    const path = imagePathname(url);
    return path ? [path] : [];
  }))];
}

export function classifyLiveDomRegion(ancestorHints: string[]): LiveDomRegion {
  const lowered = ancestorHints.map((hint) => hint.toLowerCase());
  if (lowered.some((hint) => /header|role=['"]?banner/.test(hint))) return "header";
  if (lowered.some((hint) => /(?:^|\s)nav(?:\s|$)|role=['"]?navigation/.test(hint))) {
    return "nav";
  }
  if (lowered.some((hint) => /footer|role=['"]?contentinfo/.test(hint))) return "footer";
  if (lowered.some((hint) => /aside|role=['"]?complementary/.test(hint))) return "aside";
  if (lowered.some((hint) => RELATED_HINT.test(hint))) return "related";
  if (lowered.some((hint) => GALLERY_HINT.test(hint))) return "gallery";
  if (lowered.some((hint) => /(?:^|\s)main(?:\s|$)|role=['"]?main|article/.test(hint))) {
    return "main";
  }
  return "unknown";
}

function regionOf(element: VisibleElementSnapshot): LiveDomRegion {
  const hints = element.ancestorHints ?? [];
  if (hints.some((hint) => RELATED_HINT.test(hint))) return "related";
  return element.region ?? classifyLiveDomRegion(hints);
}

export function galleryIdentityKey(url: string | null | undefined) {
  if (!url) return null;
  try {
    return imageIdentityKey(url);
  } catch {
    return canonicalizeLiveUrl(url) ?? imagePathname(url);
  }
}

export function srcsetCandidateUrls(srcset: string | null | undefined): string[] {
  if (!srcset?.trim()) return [];
  return [...new Set(
    srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter((url): url is string => Boolean(url)),
  )];
}

const LAZY_PLACEHOLDER_SOURCE =
  /(?:^|[/_.-])(?:grey|gray)[_-]?4[_-]?3(?:[/_.-]|$)|placeholder|no[-_]?image|blank\.(?:gif|png)|transparent\.(?:gif|png)|spacer\.(?:gif|png)/i;
const IMAGE_HREF = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

function preferredCandidate(urls: Array<string | null | undefined>) {
  const unique = [...new Set(
    urls
      .map((url) => normalizeHttpImageUrl(url))
      .filter((url): url is string =>
        url != null && !/\.svg(?:$|[?#])/i.test(url)),
  )];
  let best: { url: string; score: number; index: number } | null = null;
  for (const [index, url] of unique.entries()) {
    let score = LAZY_PLACEHOLDER_SOURCE.test(url) ? -10_000_000 : 0;
    try {
      score += imageQualityScore(url);
    } catch {
      // Keep the stable candidate order when a URL cannot be scored.
    }
    if (!best || score > best.score) best = { url, score, index };
  }
  return best ? canonicalizeImageUrl(best.url) : null;
}

export function preferredImageSrc(
  element: Pick<VisibleElementSnapshot, "currentSrc" | "src" | "dataSrc" | "srcset"> &
    Partial<Pick<VisibleElementSnapshot, "href">>,
): string | null {
  return preferredCandidate([
    element.currentSrc,
    element.dataSrc,
    ...srcsetCandidateUrls(element.srcset),
    element.src,
    element.href && IMAGE_HREF.test(element.href) ? element.href : null,
  ]);
}

export function visibleImageSrcs(
  element: Pick<VisibleElementSnapshot, "currentSrc" | "src" | "dataSrc" | "srcset"> &
    Partial<Pick<VisibleElementSnapshot, "href">>,
): string[] {
  return [...new Set(
    [
      element.currentSrc,
      element.src,
      element.dataSrc,
      ...srcsetCandidateUrls(element.srcset),
      element.href && IMAGE_HREF.test(element.href) ? element.href : null,
    ].filter((url): url is string => Boolean(url)),
  )];
}

function netDirectorOwned(src: string, stockId: string | null | undefined) {
  if (!stockId) return false;
  const numericCores = stockIdCores(stockId).filter((core) => /^\d{5,}$/.test(core));
  let identity = src;
  try {
    identity = imageIdentityKey(src);
  } catch {
    // Fall back to the raw URL.
  }
  return numericCores.some((core) =>
    new RegExp(`nds${core}(?:_|[^0-9]|$)`, "i").test(identity),
  );
}

function isChromeRegion(region: LiveDomRegion) {
  return CHROME_REGIONS.has(region);
}

function isNavOrIndexHref(href: string) {
  try {
    const path = new URL(href).pathname;
    return NAV_PATH.test(path) || STOCK_INDEX_PATH.test(path);
  } catch {
    return NAV_PATH.test(href) || STOCK_INDEX_PATH.test(href);
  }
}

export function cardBindsToPlan(
  card: Pick<ObservedStockCard, "canonicalUrl" | "stockId" | "href">,
  planned: LivePlannedIdentity[],
) {
  return planned.some((listing) => {
    const urlMatch =
      listing.canonicalUrl != null &&
      card.canonicalUrl != null &&
      listing.canonicalUrl === card.canonicalUrl;
    const stockMatch = stockIdsEquivalent(listing.stockId, card.stockId);
    return urlMatch || stockMatch;
  });
}

function isStockCardShape(input: {
  href: string;
  src: string | null;
  priceText: string | null;
  stockId: string | null;
  region: LiveDomRegion;
}) {
  if (isChromeRegion(input.region)) return false;
  if (isNavOrIndexHref(input.href)) return false;
  if (input.stockId) return true;
  return Boolean(input.src && input.priceText);
}

export function preferredListingPriceText(text: string) {
  const candidates: Array<{ text: string; value: number }> = [];
  for (const match of text.matchAll(PRICE)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 32), index).toLowerCase();
    const suffix = text
      .slice(index + match[0].length, index + match[0].length + 20)
      .toLowerCase();
    if (
      /\b(?:deposit|save|saving|apr|total payable)[^£\d]{0,12}$/.test(prefix) ||
      /^\s*(?:off|deposit|saving)\b/.test(suffix)
    ) {
      continue;
    }
    const value = parsePricePence(match[0]);
    if (value != null) candidates.push({ text: match[0], value });
  }
  const cashPrices = candidates.filter((candidate) => candidate.value >= 100_000);
  const ranked = cashPrices.length > 0 ? cashPrices : candidates;
  return ranked.sort((left, right) => left.value - right.value)[0]?.text ?? null;
}

export function collectVisibleStockCards(
  elements: VisibleElementSnapshot[],
  options: { planned?: LivePlannedIdentity[] } = {},
): ObservedStockCard[] {
  const cards = elements.flatMap((element) => {
    if (!element.visible) return [];
    const href = element.href;
    if (!href) return [];
    const largeEnough =
      element.width >= MIN_CARD_EDGE && element.height >= MIN_CARD_EDGE;
    const src = preferredImageSrc(element);
    const priceText = preferredListingPriceText(element.text);
    const stockId = extractStockIdFromUrl(href);
    const region = regionOf(element);
    if (!largeEnough && !src) return [];
    if (!isStockCardShape({ href, src, priceText, stockId, region })) return [];
    const title = element.text.slice(0, 200);
    const card: ObservedStockCard = {
      href,
      canonicalUrl: canonicalizeLiveUrl(href),
      stockId,
      title,
      titleReliable: !isCardBadgeTitle(title),
      priceText,
      pricePence: priceText ? parsePricePence(priceText) : null,
      imageSrc: src,
      top: element.top,
      left: element.left,
    };
    if (options.planned?.length && !cardBindsToPlan(card, options.planned) && !stockId && !priceText) {
      return [];
    }
    return [card];
  });
  return uniqueBy(
    [...cards].sort((left, right) => left.top - right.top || left.left - right.left),
    (card) => card.canonicalUrl ?? card.href,
  );
}

export function imageAnchoredToOtherListing(
  element: VisibleElementSnapshot,
  scope: GalleryScope,
) {
  const href = element.ownerHref ?? element.href;
  if (!href || !scope.listingUrl) return false;
  try {
    if (/\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(new URL(href).pathname)) {
      return false;
    }
  } catch {
    // Continue with the identity check for malformed hrefs.
  }
  const owner = canonicalizeLiveUrl(href);
  const listing = canonicalizeLiveUrl(scope.listingUrl);
  if (!owner || !listing || owner === listing) return false;
  const ownerStock = extractStockIdFromUrl(href);
  const listingStock = scope.stockId ?? extractStockIdFromUrl(scope.listingUrl);
  if (ownerStock && listingStock) return !stockIdsEquivalent(ownerStock, listingStock);
  return Boolean(ownerStock);
}

export function imageOwnedByListing(
  src: string,
  scope: GalleryScope,
  element?: VisibleElementSnapshot,
) {
  if (element && imageAnchoredToOtherListing(element, scope)) return false;
  const path = imagePathname(src) ?? "";
  const stockId = scope.stockId?.trim();
  if (stockId) {
    const tokens = stockIdCores(stockId);
    if (
      tokens.some((token) => ownerTokenMatches(path, token) || ownerTokenMatches(src, token)) ||
      netDirectorOwned(src, stockId) ||
      (element && visibleImageSrcs(element).some((candidate) => netDirectorOwned(candidate, stockId)))
    ) {
      return true;
    }
  }
  if ((scope.ownerImagePaths ?? []).some((hint) => path === hint || path.endsWith(hint))) {
    return true;
  }
  const owner = canonicalizeLiveUrl(element?.ownerHref ?? element?.href ?? null);
  const listing = canonicalizeLiveUrl(scope.listingUrl ?? null);
  return Boolean(owner && listing && owner === listing);
}

export function collectVisibleGallery(
  elements: VisibleElementSnapshot[],
  scope: GalleryScope = {},
): ObservedDetailGallery {
  const scoped = Boolean(
    scope.listingUrl || scope.stockId || (scope.ownerImagePaths?.length ?? 0) > 0,
  );
  const images = elements
    .filter((element) => {
      const src = preferredImageSrc(element);
      if (!src) return false;
      const region = regionOf(element);
      if (isChromeRegion(region) || RELATED_REGIONS.has(region)) return false;
      if (scoped && imageAnchoredToOtherListing(element, scope)) return false;
      const explicitGallery = GALLERY_REGIONS.has(region);
      const width = Math.max(element.width, element.naturalWidth ?? 0);
      const height = Math.max(element.height, element.naturalHeight ?? 0);
      if (width < MIN_GALLERY_EDGE || height < MIN_GALLERY_EDGE) return false;
      if (!element.visible && !explicitGallery) return false;
      if (explicitGallery) {
        return scoped
          ? imageOwnedByListing(src, scope, element)
          : element.visible;
      }
      return scoped && imageOwnedByListing(src, scope, element);
    });
  const nonCloneImages = images.filter(
    (image) =>
      !(image.ancestorHints ?? []).some((hint) =>
        /swiper-slide-duplicate|slick-cloned|owl-cloned|splide__slide--clone/i.test(hint),
      ),
  );
  const candidates = nonCloneImages.length > 0 ? nonCloneImages : images;
  const byIdentity = new Map<string, VisibleElementSnapshot>();
  const identityOrder: string[] = [];
  for (const image of candidates) {
    const identity =
      galleryIdentityKey(preferredImageSrc(image)) ??
      canonicalizeLiveUrl(preferredImageSrc(image) ?? "") ??
      preferredImageSrc(image);
    if (!identity) continue;
    const existing = byIdentity.get(identity);
    if (!existing) identityOrder.push(identity);
    const imageArea = image.visible ? image.width * image.height : -1;
    const existingArea = existing?.visible
      ? existing.width * existing.height
      : -1;
    if (!existing || imageArea > existingArea) byIdentity.set(identity, image);
  }
  const unique = identityOrder.flatMap((identity) => {
    const image = byIdentity.get(identity);
    return image ? [image] : [];
  });
  const maxVisibleArea = unique.reduce(
    (max, image) =>
      image.visible ? Math.max(max, image.width * image.height) : max,
    0,
  );
  const heroIndex = unique.findIndex(
    (image) =>
      image.visible &&
      image.width * image.height >= maxVisibleArea * 0.5,
  );
  const ordered =
    heroIndex > 0
      ? [unique[heroIndex]!, ...unique.slice(0, heroIndex), ...unique.slice(heroIndex + 1)]
      : unique;
  const gallerySrcs = ordered.flatMap((image) => {
    const src = preferredImageSrc(image);
    return src ? [src] : [];
  });
  return {
    heroSrc: gallerySrcs[0] ?? null,
    gallerySrcs,
    galleryAlts: ordered.map((image) => {
      const preferred = preferredImageSrc(image);
      return visibleImageSrcs(image).find((candidate) => candidate !== preferred) ?? null;
    }),
  };
}

export function collectStockPaginationHrefs(
  elements: VisibleElementSnapshot[],
  currentUrl: string,
  visited: Set<string>,
  allowedHosts: readonly string[] = [],
) {
  let currentHost = "";
  try {
    currentHost = new URL(currentUrl).hostname.toLowerCase();
  } catch {
    currentHost = "";
  }
  return uniqueBy(
    elements.flatMap((element) => {
      if (!element.href) return [];
      const canonical = canonicalizeLiveUrl(element.href);
      if (!canonical || visited.has(canonical)) return [];
      if (!inspectLiveNavigation(element.href, allowedHosts).ok) return [];
      try {
        const host = new URL(element.href).hostname.toLowerCase();
        if (currentHost && host !== currentHost) return [];
      } catch {
        return [];
      }
      const text = element.text.trim();
      if (
        PAGINATION_PATH.test(element.href) ||
        /^(next|older|more|›|>)$/i.test(text) ||
        /next page|load more|show more|see more/i.test(text)
      ) {
        return [canonical];
      }
      return [];
    }),
    (href) => href,
  );
}

export async function collectStockCardsWithBoundedLoadMore(
  page: LiveBrowserPage,
  planned: LivePlannedIdentity[] = [],
  allowedHosts: readonly string[] = [],
): Promise<ObservedStockCard[]> {
  const startUrl = canonicalizeLiveUrl(page.url()) ?? page.url();
  const collected = [...collectVisibleStockCards(await page.snapshotAnchors(), { planned })];
  for (let click = 0; click < MAX_LOAD_MORE_CLICKS; click += 1) {
    const clicked = await page.clickVisibleLoadMore();
    if (!clicked) break;
    const landed = page.url();
    if (!inspectLiveNavigation(landed, allowedHosts).ok) break;
    if (NAV_PATH.test(landed)) break;
    collected.push(...collectVisibleStockCards(await page.snapshotAnchors(), { planned }));
    const landedCanon = canonicalizeLiveUrl(landed) ?? landed;
    if (landedCanon !== startUrl && !PAGINATION_PATH.test(landed)) {
      break;
    }
  }
  const seen = new Set<string>();
  return collected.filter((card) => {
    const key = stockCardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function stockCardKey(card: Pick<ObservedStockCard, "canonicalUrl" | "href" | "stockId">) {
  return card.canonicalUrl ?? (card.stockId ? `stock:${card.stockId}` : card.href);
}

export function stockCardDeltas(
  t0: ObservedStockCard[],
  t1: ObservedStockCard[],
) {
  const t0Keys = new Set(t0.map(stockCardKey));
  const t1Keys = new Set(t1.map(stockCardKey));
  const added = t1
    .filter((card) => !t0Keys.has(stockCardKey(card)))
    .map(stockCardKey);
  const removed = t0
    .filter((card) => !t1Keys.has(stockCardKey(card)))
    .map(stockCardKey);
  return {
    added,
    removed,
    unchanged: t0.filter((card) => t1Keys.has(stockCardKey(card))).length,
  };
}

export function navigationFailure(
  url: string,
  error: string,
  status: number | null = null,
): LiveNavigationResult {
  return {
    ok: false,
    status,
    url,
    title: "",
    error,
    blocked: isBlockedNavigation({ status, title: "", error }),
  };
}
