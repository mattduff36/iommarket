import type {
  LiveCensusCardDelta,
  LiveDealerCensus,
  LiveVisualListingResult,
} from "./live-types";

export const CENSUS_DRIFT_HIDE_REASON = "census-drift";
export const T1_STOCK_LIST_INACCESSIBLE_REASON = "t1-stock-list-inaccessible";

const EMPTY_DELTAS: LiveCensusCardDelta = { added: [], removed: [], unchanged: 0 };

export function buildLiveDealerCensus(input: {
  dealerKey: string;
  plannedCount: number;
  matchedCount: number;
  extraObservedCount: number;
  t0Accessible: boolean;
  t0PageUrl: string | null;
  t0CardCount: number;
  t1Attempted: number;
  t1AccessibleCount: number;
  t1InaccessibleCount: number;
  t1ListAccessible?: boolean;
  t1ListPageUrl?: string | null;
  t1ListCardCount?: number;
  cardDeltas?: LiveCensusCardDelta;
  evidencePaths?: LiveDealerCensus["evidencePaths"];
}): LiveDealerCensus {
  const cardDeltas = input.cardDeltas ?? EMPTY_DELTAS;
  const t1ListCardCount = input.t1ListCardCount ?? 0;
  const t1ListAccessible = input.t1ListAccessible ?? false;
  const disappeared =
    input.t0Accessible &&
    t1ListAccessible &&
    cardDeltas.removed.length > 0;
  const drift = disappeared;
  return {
    dealerKey: input.dealerKey,
    t0Accessible: input.t0Accessible,
    t0PageUrl: input.t0PageUrl,
    t0CardCount: input.t0CardCount,
    t1Attempted: input.t1Attempted,
    t1AccessibleCount: input.t1AccessibleCount,
    t1InaccessibleCount: input.t1InaccessibleCount,
    t1ListAccessible,
    t1ListPageUrl: input.t1ListPageUrl ?? null,
    t1ListCardCount,
    plannedCount: input.plannedCount,
    matchedCount: input.matchedCount,
    extraObservedCount: input.extraObservedCount,
    cardDeltas,
    drift,
    evidencePaths: input.evidencePaths ?? { t0: null, t1: [], t1List: null },
  };
}

export function dealerShouldHidePack(input: {
  t0Accessible: boolean;
  t1AccessibleCount: number;
  plannedCount: number;
  inaccessibleListings: number;
  unverifiedListings?: number;
  censusDrift?: boolean;
  t1ListAccessible?: boolean;
}) {
  return (
    !input.t0Accessible ||
    input.inaccessibleListings > 0 ||
    (input.unverifiedListings ?? 0) > 0 ||
    input.censusDrift === true ||
    (input.t0Accessible && input.t1ListAccessible === false)
  );
}

export function hidePackReason(input: {
  hidePack: boolean;
  t0Accessible: boolean;
  inaccessibleListings: number;
  unverifiedListings?: number;
  censusDrift?: boolean;
  t1ListAccessible?: boolean;
}) {
  if (!input.hidePack) return null;
  if ((input.unverifiedListings ?? 0) > 0) return "listing-unverified";
  if (!input.t0Accessible && input.inaccessibleListings === 0) {
    return "dealer-site-inaccessible";
  }
  if (input.inaccessibleListings > 0) return "listing-inaccessible";
  if (input.t0Accessible && input.t1ListAccessible === false) {
    return T1_STOCK_LIST_INACCESSIBLE_REASON;
  }
  if (input.censusDrift) return CENSUS_DRIFT_HIDE_REASON;
  return "inaccessible";
}

export function applyCensusDriftToListings(
  listings: LiveVisualListingResult[],
  censusDrift: boolean,
): LiveVisualListingResult[] {
  if (!censusDrift) return listings;
  return listings.map((listing) => {
    if (listing.status === "pass") {
      return {
        ...listing,
        status: "drift",
        hidePack: true,
        findings: listing.findings.includes(CENSUS_DRIFT_HIDE_REASON)
          ? listing.findings
          : [...listing.findings, CENSUS_DRIFT_HIDE_REASON],
      };
    }
    return { ...listing, hidePack: true };
  });
}
