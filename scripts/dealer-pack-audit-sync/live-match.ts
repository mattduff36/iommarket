import type { PlannedListing } from "./types";
import type {
  LiveMatchEvidence,
  LiveObservedIdentity,
  LivePlannedIdentity,
} from "./live-types";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

const IDENTITY_PREFIX =
  /^(stockId|sourceVehicleId|stockReference|vin|registration):(.+)$/i;

const STOCK_QUERY_KEYS = new Set([
  "id",
  "stockid",
  "stock_id",
  "vehicleid",
  "vehicle_id",
  "vrm",
  "registration",
]);

export function canonicalizeLiveUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    const search = parsed.searchParams.toString();
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    return `${parsed.origin}${path}${search ? `?${search}` : ""}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "") || null;
  }
}

const ID_PREFIXED_STOCK = /^id-([a-z0-9][a-z0-9_-]{0,64})$/i;
const NUMERIC_SEO_STOCK = /^(\d{5,})-[a-z0-9]/i;
const STOCK_PATH_SEGMENT = /^[a-z0-9][a-z0-9_-]{1,64}$/i;
const CARD_BADGE_TITLE = /^(coming soon|available|sold)$/;
const NON_TITLE_MEASUREMENT = /^\d{1,6}(?:\s*(?:miles?|mi|km))?$/;
const CARD_BADGE_PRICE = /(?:£|&pound;|GBP)\s*[\d,]{1,8}(?:\.\d{2})?/gi;

export function normalizeStockId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "");
  return normalized || null;
}

export function stockIdCores(value: string | null | undefined): string[] {
  const normalized = normalizeStockId(value);
  if (!normalized) return [];
  const cores = new Set<string>([normalized]);
  const idPrefixed = ID_PREFIXED_STOCK.exec(normalized);
  if (idPrefixed?.[1]) cores.add(idPrefixed[1]);
  if (normalized.includes("/")) {
    const last = normalized.split("/").filter(Boolean).at(-1);
    if (last) cores.add(last);
  }
  const seo = NUMERIC_SEO_STOCK.exec(normalized);
  if (seo?.[1]) cores.add(seo[1]);
  return [...cores];
}

export function stockIdsEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftCores = stockIdCores(left);
  const rightCores = stockIdCores(right);
  if (leftCores.length === 0 || rightCores.length === 0) return false;
  return leftCores.some((core) => rightCores.includes(core));
}

export function extractStockIdFromIdentity(identityKey: string): string | null {
  const match = IDENTITY_PREFIX.exec(identityKey.trim());
  return normalizeStockId(match?.[2] ?? null);
}

function stockIdFromPathSegment(segment: string): string | null {
  const cleaned = segment.replace(/\.(html?|php|aspx)$/i, "");
  const idPrefixed = ID_PREFIXED_STOCK.exec(cleaned);
  if (idPrefixed?.[1]) return normalizeStockId(idPrefixed[1]);
  if (/^\d{5,}$/.test(cleaned)) return normalizeStockId(cleaned);
  const seo = NUMERIC_SEO_STOCK.exec(cleaned);
  if (seo?.[1]) return normalizeStockId(seo[1]);
  if (STOCK_PATH_SEGMENT.test(cleaned)) return normalizeStockId(cleaned);
  return null;
}

export function extractStockIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (STOCK_QUERY_KEYS.has(key.toLowerCase()) && value.trim()) {
        return normalizeStockId(value);
      }
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (const segment of [...segments].reverse()) {
      const idPrefixed = ID_PREFIXED_STOCK.exec(segment.replace(/\.(html?|php|aspx)$/i, ""));
      if (idPrefixed?.[1]) return normalizeStockId(idPrefixed[1]);
    }
    for (const segment of [...segments].reverse()) {
      const extracted = stockIdFromPathSegment(segment);
      if (extracted) return extracted;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractStockId(
  identityKey: string,
  sourceUrl?: string | null,
): string | null {
  return extractStockIdFromIdentity(identityKey) ?? extractStockIdFromUrl(sourceUrl);
}

export function parsePricePence(text: string | null | undefined): number | null {
  if (!text) return null;
  const compact = text.replace(/,/g, "").replace(/\s+/g, " ").trim();
  const match = compact.match(/(?:£|&pound;|gbp)?\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match?.[1]) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const hasPoundsMark = /£|&pound;|gbp/i.test(compact);
  if (hasPoundsMark) return Math.round(amount * 100);
  if (amount >= 100_000 && Number.isInteger(amount)) return amount;
  return Math.round(amount * 100);
}

export function normalizeLiveTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isCardBadgeTitle(title: string) {
  const stripped = title.replace(CARD_BADGE_PRICE, " ");
  const normalized = normalizeLiveTitle(stripped);
  return (
    normalized.length === 0 ||
    CARD_BADGE_TITLE.test(normalized) ||
    NON_TITLE_MEASUREMENT.test(normalized)
  );
}

export function titlesMatch(planned: string, observed: string) {
  if (isCardBadgeTitle(observed)) return false;
  const plannedTokens = normalizeLiveTitle(planned)
    .split(" ")
    .filter((token) => token.length > 1);
  const observedTokens = new Set(
    normalizeLiveTitle(observed)
      .split(" ")
      .filter((token) => token.length > 1),
  );
  if (plannedTokens.length === 0 || observedTokens.size === 0) return false;
  const overlap = plannedTokens.filter((token) => observedTokens.has(token)).length;
  return overlap / plannedTokens.length >= 0.6;
}

export function plannedLiveIdentity(listing: PlannedListing): LivePlannedIdentity {
  return {
    identityKey: listing.identityKey,
    sourceUrl: listing.sourceUrl,
    canonicalUrl: canonicalizeLiveUrl(listing.sourceUrl),
    stockId: extractStockId(listing.identityKey, listing.sourceUrl),
    title: listing.listing.title,
    pricePence: listing.listing.pricePence,
  };
}

export function compareLiveIdentities(
  planned: LivePlannedIdentity,
  observed: LiveObservedIdentity,
): LiveMatchEvidence {
  const url =
    planned.canonicalUrl != null &&
    observed.canonicalUrl != null &&
    planned.canonicalUrl === observed.canonicalUrl;
  const stockEquivalent = stockIdsEquivalent(planned.stockId, observed.stockId);
  const stockIdConflict =
    planned.stockId != null &&
    observed.stockId != null &&
    !stockEquivalent;
  const stockId = stockEquivalent;
  const title = titlesMatch(planned.title, observed.title);
  const titleConflict =
    observed.titleReliable &&
    !isCardBadgeTitle(observed.title) &&
    observed.title.trim().length > 0 &&
    normalizeLiveTitle(observed.title).length > 0 &&
    !title;
  const price =
    planned.pricePence != null &&
    observed.pricePence != null &&
    observed.pricePence === planned.pricePence;
  const priceConflict =
    planned.pricePence != null &&
    observed.pricePence != null &&
    observed.pricePence !== planned.pricePence;
  const assignedBy = url
    ? "url"
    : stockId
      ? "stock-id"
      : title && price
        ? "title-price"
        : null;
  return {
    url,
    stockId,
    title,
    price,
    stockIdConflict,
    titleConflict,
    priceConflict,
    assignedBy,
  };
}

export function isIdentityMatch(evidence: LiveMatchEvidence) {
  return evidence.assignedBy != null;
}

export function identityMismatch(evidence: LiveMatchEvidence) {
  if (evidence.url) {
    return evidence.titleConflict || evidence.priceConflict;
  }
  return evidence.stockIdConflict || evidence.titleConflict || evidence.priceConflict;
}

export interface LiveAssignment {
  planned: LivePlannedIdentity;
  observed: LiveObservedIdentity | null;
  match: LiveMatchEvidence;
}

function emptyMatch(): LiveMatchEvidence {
  return {
    url: false,
    stockId: false,
    title: false,
    price: false,
    stockIdConflict: false,
    titleConflict: false,
    priceConflict: false,
    assignedBy: null,
  };
}

export function assignLiveMatches(
  planned: LivePlannedIdentity[],
  observed: LiveObservedIdentity[],
): { assignments: LiveAssignment[]; extraObserved: LiveObservedIdentity[] } {
  const remaining = [...observed];
  const assignments: LiveAssignment[] = [];

  const take = (
    listing: LivePlannedIdentity,
    predicate: (item: LiveObservedIdentity, evidence: LiveMatchEvidence) => boolean,
  ) => {
    const index = remaining.findIndex((item) =>
      predicate(item, compareLiveIdentities(listing, item)),
    );
    if (index < 0) return null;
    const [item] = remaining.splice(index, 1);
    return item ?? null;
  };

  for (const listing of planned) {
    const byUrl = take(listing, (_item, evidence) => evidence.url);
    const byStock = byUrl ?? take(listing, (_item, evidence) => evidence.stockId);
    const byTitlePrice =
      byStock ??
      take(listing, (_item, evidence) => evidence.title && evidence.price);
    const matched = byTitlePrice;
    assignments.push({
      planned: listing,
      observed: matched,
      match: matched ? compareLiveIdentities(listing, matched) : emptyMatch(),
    });
  }

  return { assignments, extraObserved: remaining };
}
