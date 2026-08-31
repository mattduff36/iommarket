const STOCK_HREF =
  /used|stock|cars|vehicles|latest|motors|for-sale|for_sale|pre-owned|preowned|inventory|motor|showroom/i;
const STOCK_TEXT =
  /used|stock|cars|vehicles|latest|motors|for sale|pre-owned|inventory|our range|latest range/i;
const REJECT =
  /login|sign-in|signin|account|facebook|instagram|twitter|youtube|linkedin|privacy|cookie|terms|contact|about|finance|servic|parts|motability|book|valuation|sell.your|careers|news|blog/i;

export interface RankedLink {
  href: string;
  text: string;
  score: number;
}

export function sameRegistrableHost(left: string, right: string) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    if (a.protocol !== "http:" && a.protocol !== "https:") return false;
    if (b.protocol !== "http:" && b.protocol !== "https:") return false;
    return a.hostname === b.hostname || a.hostname.endsWith(`.${b.hostname}`) || b.hostname.endsWith(`.${a.hostname}`);
  } catch {
    return false;
  }
}

export function normalizeHref(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function scoreStockLink(href: string, text: string, originUrl: string): number | null {
  const absolute = normalizeHref(href, originUrl);
  if (!absolute) return null;
  if (!sameRegistrableHost(absolute, originUrl)) return null;
  const haystack = `${absolute} ${text}`.toLowerCase();
  if (REJECT.test(haystack)) return null;
  let score = 0;
  if (STOCK_HREF.test(absolute)) score += 4;
  if (STOCK_TEXT.test(text)) score += 5;
  if (/used-cars|used\/|\/used|pre-owned|latest-range|cars-for-sale/i.test(absolute)) score += 3;
  if (score === 0) return null;
  return score;
}

export function rankStockLinks(
  links: Array<{ href: string; text: string }>,
  originUrl: string,
  visited: Set<string>,
): RankedLink[] {
  const ranked = new Map<string, RankedLink>();
  for (const link of links) {
    const href = normalizeHref(link.href, originUrl);
    if (!href || visited.has(href)) continue;
    const score = scoreStockLink(href, link.text, originUrl);
    if (score == null) continue;
    const existing = ranked.get(href);
    if (!existing || existing.score < score) {
      ranked.set(href, { href, text: link.text.trim().slice(0, 80), score });
    }
  }
  return [...ranked.values()].sort((left, right) => right.score - left.score);
}

export const KNOWN_GOOD_DEALERS = ["athol-garage", "bcc-cars", "ocean-motor-village"] as const;
export const PARTIAL_DEALERS = ["ingear-car-sales", "kingswood-honda", "mikes-motors", "motorx"] as const;

export function shouldInspectDealer(input: {
  dealerKey: string;
  uniqueVehicles: number;
  hasUrl: boolean;
}) {
  if (!input.hasUrl) return { inspect: false, kind: "skipped" as const, reason: "no-url" };
  if ((KNOWN_GOOD_DEALERS as readonly string[]).includes(input.dealerKey)) {
    return { inspect: false, kind: "skipped" as const, reason: "known-good" };
  }
  if ((PARTIAL_DEALERS as readonly string[]).includes(input.dealerKey)) {
    return { inspect: true, kind: "partial" as const, reason: "partial-homepage-cards" };
  }
  if (input.uniqueVehicles === 0) {
    return { inspect: true, kind: "zero" as const, reason: "zero-unique" };
  }
  return { inspect: false, kind: "skipped" as const, reason: "has-stock" };
}
