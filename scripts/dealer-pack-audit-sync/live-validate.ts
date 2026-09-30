import { getDealer } from "../dealer-stock-sync/registry";
import { canonicalizeImageUrl } from "../dealer-stock-sync/image-urls";
import type {
  ExcludedListingEvidence,
  PackAuditAction,
  PackBaseline,
  PlannedListing,
  PreviewPackAuditPlan,
} from "./types";
import {
  applyCensusDriftToListings,
  buildLiveDealerCensus,
  dealerShouldHidePack,
  hidePackReason,
} from "./live-census";
import {
  assignLiveMatches,
  canonicalizeLiveUrl,
  compareLiveIdentities,
  extractStockIdFromUrl,
  parsePricePence,
  plannedLiveIdentity,
} from "./live-match";
import {
  allowedLiveHosts,
  collectStockCardsWithBoundedLoadMore,
  collectStockPaginationHrefs,
  collectVisibleGallery,
  galleryIdentityKey,
  gotoAllowed,
  preferredListingPriceText,
  MAX_STOCK_LIST_PAGES,
  navigationFailure,
  ownerImagePathHints,
  stockCardDeltas,
  stockCardKey,
  type LiveBrowserFactory,
  type LiveBrowserPage,
  type LiveBrowserSession,
  type LiveNavigationResult,
  type ObservedStockCard,
} from "./live-observe";
import {
  inspectRemoteImage,
  plannedGalleryAlignsWithLive,
  type LiveImageFetcher,
} from "./live-quality";
import {
  buildLiveVisualReport,
  liveVisualEvidenceDir,
  liveVisualEvidenceRelPath,
} from "./live-report";
import { liveListingFlags, resolveLiveListingStatus } from "./live-status";
import type {
  LiveDealerSite,
  LiveImageSignal,
  LiveObservedIdentity,
  LivePlannedIdentity,
  LiveVisualDealerResult,
  LiveVisualListingResult,
  LiveVisualReport,
} from "./live-types";

export interface LiveEvidenceStore {
  write(relPath: string, contents: Buffer | string): Promise<string>;
}

export interface LiveValidateDeps {
  browser: LiveBrowserSession | LiveBrowserFactory;
  fetchImage: LiveImageFetcher;
  resolveSite?: (dealerKey: string, plannedUrls: Array<string | null>) => LiveDealerSite;
  evidence?: LiveEvidenceStore;
  now?: () => string;
}

function dealerSiteFromRegistry(
  dealerKey: string,
  plannedUrls: Array<string | null>,
): LiveDealerSite {
  try {
    const dealer = getDealer(dealerKey);
    return {
      dealerKey,
      website: dealer.website,
      stockUrls: [...dealer.stockUrls],
    };
  } catch {
    const urls = [...new Set(
      plannedUrls.flatMap((url) => {
        try {
          return url ? [`${new URL(url).origin}/`] : [];
        } catch {
          return [];
        }
      }),
    )];
    return { dealerKey, website: urls[0] ?? null, stockUrls: urls };
  }
}

async function openSession(
  browser: LiveBrowserSession | LiveBrowserFactory,
): Promise<LiveBrowserSession> {
  return typeof browser === "function" ? browser() : browser;
}

async function writeEvidence(
  store: LiveEvidenceStore | undefined,
  relPath: string,
  contents: Buffer | string | null,
) {
  if (!store || contents == null) return null;
  return store.write(relPath, contents);
}

function stockListTargets(site: LiveDealerSite) {
  const stockUrls = [...new Set(site.stockUrls.filter((url): url is string => Boolean(url)))];
  const homepage = site.website?.trim() || null;
  const homepageFallback =
    homepage &&
    !stockUrls.some((url) => canonicalizeLiveUrl(url) === canonicalizeLiveUrl(homepage))
      ? homepage
      : null;
  return { stockUrls, homepageFallback };
}

function hostSeedUrls(site: LiveDealerSite) {
  const { stockUrls, homepageFallback } = stockListTargets(site);
  return [...stockUrls, homepageFallback].filter((url): url is string => Boolean(url));
}

function excludedToPlanned(excluded: ExcludedListingEvidence): PlannedListing {
  return {
    identityKey: excluded.identityKey,
    sourceUrl: excluded.sourceUrl,
    listing: {
      title: excluded.title ?? excluded.identityKey,
      description: excluded.reasons.join("; ") || "Disabled pack source listing.",
      pricePence: 0,
      categorySlug: "car",
      attributes: {},
      imageUrls: [],
    },
    images: [],
    findings: excluded.findings,
  };
}

function baselineToUnverified(listing: PackBaseline["listings"][number]): PlannedListing {
  return {
    identityKey: `baseline:${listing.id}`,
    sourceUrl: null,
    listing: {
      title: listing.id,
      description: "Baseline listing without source identity.",
      pricePence: 0,
      categorySlug: "car",
      attributes: {},
      imageUrls: [],
    },
    images: [],
    findings: ["unverified-no-source-identity"],
  };
}

export function plannedListingsForAction(action: PackAuditAction): PlannedListing[] {
  if (action.kind === "replace") return action.listings;
  const sourced = action.excludedListings.filter(
    (item) => item.identityKey.trim() && item.sourceUrl,
  );
  if (sourced.length > 0) return sourced.map(excludedToPlanned);
  if (action.baseline.listings.length > 0) {
    return action.baseline.listings.map(baselineToUnverified);
  }
  return [{
    identityKey: "pack-unverified",
    sourceUrl: null,
    listing: {
      title: action.displayName,
      description: "Disabled pack has no source identities.",
      pricePence: 0,
      categorySlug: "car",
      attributes: {},
      imageUrls: [],
    },
    images: [],
    findings: ["unverified-no-source-identity"],
  }];
}

function plannedIdentityForListing(listing: PlannedListing): LivePlannedIdentity {
  const identity = plannedLiveIdentity(listing);
  if (listing.findings.includes("unverified-no-source-identity") || listing.images.length === 0) {
    return { ...identity, pricePence: listing.listing.pricePence > 0 ? listing.listing.pricePence : null };
  }
  return identity;
}

async function observeStockList(
  page: LiveBrowserPage,
  urls: string[],
  planned: LivePlannedIdentity[] = [],
  allowedHosts: readonly string[] = [],
  homepageFallback: string | null = null,
): Promise<{
  navigation: LiveNavigationResult | null;
  cards: ObservedStockCard[];
  screenshot: Buffer | null;
}> {
  const queue = urls.length > 0 ? [...urls] : homepageFallback ? [homepageFallback] : [];
  if (queue.length === 0) {
    return {
      navigation: navigationFailure("", "no-stock-url"),
      cards: [],
      screenshot: null,
    };
  }
  const visited = new Set<string>();
  const collected: ObservedStockCard[] = [];
  let lastSuccess: LiveNavigationResult | null = null;
  let lastFailure: LiveNavigationResult | null = null;
  let screenshot: Buffer | null = null;
  let triedHomepageFallback = queue.includes(homepageFallback ?? "");
  while (queue.length > 0 && visited.size < MAX_STOCK_LIST_PAGES) {
    const url = queue.shift();
    if (!url) break;
    const key = canonicalizeLiveUrl(url) ?? url;
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      const navigation = await gotoAllowed(page, url, allowedHosts);
      if (!navigation.ok || navigation.blocked) {
        lastFailure = navigation;
        continue;
      }
      collected.push(
        ...await collectStockCardsWithBoundedLoadMore(page, planned, allowedHosts),
      );
      lastSuccess = navigation;
      if (!screenshot) screenshot = await page.screenshot();
      const anchors = await page.snapshotAnchors();
      queue.push(
        ...collectStockPaginationHrefs(anchors, navigation.url, visited, allowedHosts),
      );
    } catch (error) {
      lastFailure = navigationFailure(
        url,
        error instanceof Error ? error.message : "stock-page-failed",
      );
    }
  }
  if (
    !lastSuccess &&
    homepageFallback &&
    !triedHomepageFallback &&
    visited.size < MAX_STOCK_LIST_PAGES
  ) {
    triedHomepageFallback = true;
    queue.push(homepageFallback);
    while (queue.length > 0 && visited.size < MAX_STOCK_LIST_PAGES) {
      const url = queue.shift();
      if (!url) break;
      const key = canonicalizeLiveUrl(url) ?? url;
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        const navigation = await gotoAllowed(page, url, allowedHosts);
        if (!navigation.ok || navigation.blocked) {
          lastFailure = navigation;
          continue;
        }
        collected.push(
          ...await collectStockCardsWithBoundedLoadMore(page, planned, allowedHosts),
        );
        lastSuccess = navigation;
        if (!screenshot) screenshot = await page.screenshot();
      } catch (error) {
        lastFailure = navigationFailure(
          url,
          error instanceof Error ? error.message : "stock-page-failed",
        );
      }
    }
  }
  const seen = new Set<string>();
  const cards = collected.filter((card) => {
    const key = stockCardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    navigation: lastSuccess ?? lastFailure,
    cards,
    screenshot,
  };
}

function observedFromDetail(input: {
  href: string;
  title: string;
  pageText: string;
  imageSrc: string | null;
}): LiveObservedIdentity {
  const priceText = preferredListingPriceText(input.title);
  return {
    href: input.href,
    canonicalUrl: canonicalizeLiveUrl(input.href),
    stockId: extractStockIdFromUrl(input.href),
    title: input.title || input.pageText.slice(0, 200),
    titleReliable: false,
    priceText,
    pricePence: priceText ? parsePricePence(priceText) : null,
    imageSrc: input.imageSrc,
  };
}

function mergeObserved(
  card: ObservedStockCard | null,
  detail: LiveObservedIdentity | null,
): LiveObservedIdentity | null {
  if (!card && !detail) return null;
  return {
    href: card?.href ?? detail?.href ?? "",
    canonicalUrl: card?.canonicalUrl ?? detail?.canonicalUrl ?? null,
    stockId: card?.stockId ?? detail?.stockId ?? null,
    title: card?.title || detail?.title || "",
    titleReliable: card?.titleReliable ?? false,
    priceText: card?.priceText ?? detail?.priceText ?? null,
    pricePence: card?.pricePence ?? detail?.pricePence ?? null,
    imageSrc: card?.imageSrc ?? detail?.imageSrc ?? null,
  };
}

async function inspectGallery(
  urls: string[],
  fetchImage: LiveImageFetcher,
): Promise<LiveImageSignal[]> {
  const signals: LiveImageSignal[] = [];
  for (const url of urls) {
    signals.push(await inspectRemoteImage(canonicalizeImageUrl(url), fetchImage));
  }
  return signals;
}

function netDirectorDetailFallback(
  dealerKey: string,
  website: string | null,
  stockId: string | null,
  title: string,
) {
  if (!website || !stockId || !/^\d+$/.test(stockId)) return null;
  try {
    if (getDealer(dealerKey).connectorKey !== "netdirector") return null;
    return new URL(`/used-cars/${stockId}-${encodeURIComponent(title)}`, website).href;
  } catch {
    return null;
  }
}

async function evaluateListing(input: {
  dealerKey: string;
  planned: LivePlannedIdentity;
  listing: PlannedListing;
  card: ObservedStockCard | null;
  fallbackDetailUrl?: string | null;
  page: LiveBrowserPage;
  fetchImage: LiveImageFetcher;
  evidence: LiveEvidenceStore | undefined;
  censusDrift: boolean;
  allowedHosts: readonly string[];
}): Promise<{
  result: LiveVisualListingResult;
  detailAccessible: boolean;
  detailEvidence: string | null;
}> {
  const detailUrl =
    input.card?.href ?? input.planned.sourceUrl ?? input.fallbackDetailUrl ?? null;
  const unverified =
    detailUrl == null &&
    (input.listing.findings.includes("unverified-no-source-identity") || !input.card);
  let pageInaccessible = detailUrl == null && !unverified;
  let navigation: LiveNavigationResult | null = null;
  let gallery = {
    heroSrc: null as string | null,
    gallerySrcs: [] as string[],
    galleryAlts: [] as Array<string | null>,
  };
  let pageText = "";
  let screenshot: Buffer | null = null;
  if (detailUrl) {
    try {
      navigation = await gotoAllowed(input.page, detailUrl, input.allowedHosts);
      if (!navigation.ok && !navigation.blocked) {
        navigation = await gotoAllowed(input.page, detailUrl, input.allowedHosts);
      }
      pageInaccessible = !navigation.ok || navigation.blocked;
      if (!pageInaccessible) {
        const galleryScope = {
          listingUrl: detailUrl,
          stockId: input.planned.stockId,
          ownerImagePaths: ownerImagePathHints(
            input.listing.images.map((image) => image.sourceUrl),
          ),
          preferredHeroUrl: input.listing.images[0]?.sourceUrl ?? null,
        };
        const collectGallery = async () => {
          const [images, anchors] = await Promise.all([
            input.page.snapshotImages(),
            input.page.snapshotAnchors(),
          ]);
          return collectVisibleGallery([...images, ...anchors], galleryScope);
        };
        gallery = await collectGallery();
        if (gallery.gallerySrcs.length === 0) {
          const retry = await gotoAllowed(input.page, detailUrl, input.allowedHosts);
          if (retry.ok && !retry.blocked) {
            navigation = retry;
            gallery = await collectGallery();
          }
        }
        pageText = await input.page.pageText();
        screenshot = await input.page.screenshot();
      }
    } catch (error) {
      pageInaccessible = true;
      navigation = navigationFailure(
        detailUrl,
        error instanceof Error ? error.message : "detail-page-failed",
      );
    }
  }

  const detailObserved =
    navigation && !pageInaccessible
      ? observedFromDetail({
          href: navigation.url || detailUrl || "",
          title: navigation.title,
          pageText,
          imageSrc: gallery.heroSrc,
        })
      : null;
  const observed = mergeObserved(input.card, detailObserved);
  const match = observed
    ? compareLiveIdentities(input.planned, observed)
    : {
        url: false,
        stockId: false,
        title: false,
        price: false,
        stockIdConflict: false,
        titleConflict: false,
        priceConflict: false,
        assignedBy: null,
      };

  const gallerySrcs =
    gallery.gallerySrcs.length > 0
      ? gallery.gallerySrcs
      : observed?.imageSrc
        ? [observed.imageSrc]
        : [];
  const imageSignals = await inspectGallery(gallerySrcs, input.fetchImage);
  const imageEvidenceMissing =
    gallerySrcs.length > 0 &&
    (imageSignals.length === 0 ||
      imageSignals.some((signal) => signal.checksum == null));
  const plannedChecksums = input.listing.images.map((image) => image.checksum);
  const plannedUrls = input.listing.images.map((image) => image.sourceUrl);
  const imageDrift =
    plannedUrls.length > 0 &&
    gallerySrcs.length > 0 &&
    !plannedGalleryAlignsWithLive({
      plannedUrls,
      observedUrls: gallerySrcs,
      observedAltUrls: gallery.galleryAlts,
      plannedChecksums,
      observedChecksums: imageSignals.map((signal) => signal.checksum),
      canonicalize: galleryIdentityKey,
    });
  const flags = liveListingFlags({
    pageInaccessible,
    unverified: unverified || imageEvidenceMissing,
    observed: observed != null,
    galleryCount: gallerySrcs.length,
    placeholder: imageSignals.some((signal) => signal.placeholder),
    match,
    imageDrift,
    censusDrift: input.censusDrift,
  });
  const status = resolveLiveListingStatus(flags);
  const findings = [
    flags.unverified
      ? imageEvidenceMissing
        ? "unverified-image-evidence"
        : "unverified-no-source-identity"
      : null,
    pageInaccessible ? navigation?.error ?? "detail-inaccessible" : null,
    flags.empty ? "empty-gallery" : null,
    flags.placeholder ? "placeholder-image" : null,
    flags.mismatch ? "identity-mismatch" : null,
    flags.drift && !flags.mismatch ? "live-drift" : null,
    ...imageSignals.flatMap((signal) => signal.reasons),
  ].filter((finding): finding is string => Boolean(finding));

  const detailEvidence = await writeEvidence(
    input.evidence,
    liveVisualEvidenceRelPath({
      dealerKey: input.dealerKey,
      kind: "t1-detail",
      identityKey: input.planned.identityKey,
    }),
    screenshot,
  );
  const imageEvidence = imageSignals
    .map((signal) => signal.checksum)
    .filter((checksum): checksum is string => Boolean(checksum));

  return {
    detailAccessible: Boolean(navigation && !pageInaccessible),
    detailEvidence,
    result: {
      identityKey: input.planned.identityKey,
      status,
      hidePack: status === "inaccessible",
      planned: input.planned,
      observed,
      match,
      heroSrc: gallery.heroSrc,
      gallerySrcs,
      imageSignals,
      findings,
      evidencePaths: {
        stockCard: null,
        detail: detailEvidence,
        images: imageEvidence,
      },
    },
  };
}

async function validateDealer(input: {
  action: PackAuditAction;
  deps: LiveValidateDeps;
  session: LiveBrowserSession;
}): Promise<LiveVisualDealerResult> {
  const page = await input.session.openPage();
  try {
  const listings = plannedListingsForAction(input.action);
  const planned = listings.map(plannedIdentityForListing);
  const site = (input.deps.resolveSite ?? dealerSiteFromRegistry)(
    input.action.dealerKey,
    listings.map((listing) => listing.sourceUrl),
  );
  const { stockUrls, homepageFallback } = stockListTargets(site);
  const allowedHosts = allowedLiveHosts([
    ...hostSeedUrls(site),
    ...listings.map((listing) => listing.sourceUrl),
  ]);
  const stock = await observeStockList(
    page,
    stockUrls,
    planned,
    allowedHosts,
    homepageFallback,
  );
  const t0Accessible = Boolean(stock.navigation?.ok && !stock.navigation.blocked);
  const t0Evidence = await writeEvidence(
    input.deps.evidence,
    liveVisualEvidenceRelPath({
      dealerKey: input.action.dealerKey,
      kind: "t0-stock",
    }),
    stock.screenshot,
  );
  const t0Assignment = assignLiveMatches(planned, stock.cards);
  const listingResults: LiveVisualListingResult[] = [];
  const t1Evidence: string[] = [];
  let t1AccessibleCount = 0;
  let t1InaccessibleCount = 0;

  for (const assignment of t0Assignment.assignments) {
    const listing = listings.find((item) => item.identityKey === assignment.planned.identityKey);
    if (!listing) continue;
    const detailPage = await input.session.openPage();
    const evaluated = await evaluateListing({
      dealerKey: input.action.dealerKey,
      planned: assignment.planned,
      listing,
      card: assignment.observed as ObservedStockCard | null,
      fallbackDetailUrl: netDirectorDetailFallback(
        input.action.dealerKey,
        site.website,
        assignment.planned.stockId,
        listing.listing.title,
      ),
      page: detailPage,
      fetchImage: input.deps.fetchImage,
      evidence: input.deps.evidence,
      censusDrift: false,
      allowedHosts,
    }).finally(() => detailPage.close());
    if (evaluated.detailAccessible) t1AccessibleCount += 1;
    else t1InaccessibleCount += 1;
    if (evaluated.detailEvidence) t1Evidence.push(evaluated.detailEvidence);
    listingResults.push({
      ...evaluated.result,
      evidencePaths: {
        ...evaluated.result.evidencePaths,
        stockCard: t0Evidence,
      },
    });
  }

  const t1List = await observeStockList(
    page,
    stockUrls,
    planned,
    allowedHosts,
    homepageFallback,
  );
  const t1ListAccessible = Boolean(t1List.navigation?.ok && !t1List.navigation.blocked);
  const t1ListEvidence = await writeEvidence(
    input.deps.evidence,
    liveVisualEvidenceRelPath({
      dealerKey: input.action.dealerKey,
      kind: "t1-stock",
    }),
    t1List.screenshot,
  );
  const census = buildLiveDealerCensus({
    dealerKey: input.action.dealerKey,
    plannedCount: planned.length,
    matchedCount: listingResults.filter((listing) => listing.match.assignedBy != null).length,
    extraObservedCount: t0Assignment.extraObserved.length,
    t0Accessible,
    t0PageUrl: stock.navigation?.url ?? null,
    t0CardCount: stock.cards.length,
    t1Attempted: planned.length,
    t1AccessibleCount,
    t1InaccessibleCount,
    t1ListAccessible,
    t1ListPageUrl: t1List.navigation?.url ?? null,
    t1ListCardCount: t1List.cards.length,
    cardDeltas: stockCardDeltas(stock.cards, t1List.cards),
    evidencePaths: { t0: t0Evidence, t1: t1Evidence, t1List: t1ListEvidence },
  });
  const driftedListings = applyCensusDriftToListings(
    listingResults,
    census.drift,
    census.cardDeltas.removed,
  );
  const inaccessibleListings = driftedListings.filter(
    (listing) => listing.status === "inaccessible",
  ).length;
  const unverifiedListings = driftedListings.filter(
    (listing) => listing.status === "unverified",
  ).length;
  const hidePack = dealerShouldHidePack({
    t0Accessible,
    t1AccessibleCount,
    plannedCount: planned.length,
    inaccessibleListings,
    unverifiedListings,
    censusDrift: census.drift,
    t1ListAccessible,
  });

  return {
    dealerKey: input.action.dealerKey,
    displayName: input.action.displayName,
    actionKind: input.action.kind,
    hidePack,
    hideReason: hidePackReason({
      hidePack,
      t0Accessible,
      inaccessibleListings,
      unverifiedListings,
      censusDrift: census.drift,
      t1ListAccessible,
    }),
    census,
    listings: driftedListings.map((listing) => ({
      ...listing,
      hidePack:
        listing.status === "inaccessible" ||
        listing.status === "unverified" ||
        listing.status === "drift" ||
        hidePack,
    })),
    evidenceDir: liveVisualEvidenceDir(input.action.dealerKey),
  };
  } finally {
    await page.close();
  }
}

export async function runLiveVisualValidation(input: {
  plan: PreviewPackAuditPlan;
  deps: LiveValidateDeps;
  dealerKey?: string;
}): Promise<LiveVisualReport> {
  const session = await openSession(input.deps.browser);
  try {
    const dealers: LiveVisualDealerResult[] = [];
    const actions = input.dealerKey
      ? input.plan.actions.filter((action) => action.dealerKey === input.dealerKey)
      : input.plan.actions;
    for (const action of actions) {
      dealers.push(
        await validateDealer({
          action,
          deps: input.deps,
          session,
        }),
      );
    }
    return buildLiveVisualReport({
      runId: input.plan.runId,
      planFingerprint: input.plan.fingerprint,
      createdAt: input.deps.now?.() ?? new Date().toISOString(),
      dealers,
    });
  } finally {
    await session.close();
  }
}

export { dealerSiteFromRegistry };
