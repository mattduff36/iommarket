import { z } from "zod";
import { foundingListingSlug } from "../onboard-founding-dealers/identity";
import { excludedListingEvidence } from "./classify";
import { dealerCensusRecoveredAfterT0 } from "./live-census";
import {
  canonicalizeLiveUrl,
  extractStockId,
  extractStockIdFromIdentity,
} from "./live-match";
import { galleryIdentityKey } from "./live-observe";
import { assertPlanIntegrity, sealPlan } from "./plan-file";
import {
  oceanManagedKey,
  productionExcludedFromSource,
} from "./production-source";
import {
  PRODUCTION_ACCOUNTS,
  isTemporaryExcludedProductionAccount,
  type ProductionExcludedListing,
  type ProductionSourceKind,
  type ProductionSourceListing,
} from "./production-types";
import {
  LIVE_LISTING_STATUSES,
  parseLiveVisualReport,
  type LiveListingStatus,
  type LiveVisualDealerResult,
  type LiveVisualListingResult,
  type LiveVisualReport,
} from "./live-types";
import type {
  DisablePackAction,
  ExcludedListingEvidence,
  PackAuditAction,
  PlannedListing,
  PreviewLiveFinalization,
  PreviewPackAuditPlan,
  ReplacePackAction,
} from "./types";

export const LIVE_VISUAL_HIDE_PACK_REASON = "live-visual-hide-pack";
export const LIVE_VISUAL_NO_VALIDATED_LISTINGS_REASON =
  "live-visual-no-validated-listings";
export const LIVE_VISUAL_EXCLUDED_REASON = "live-visual-excluded";
export const DEALER_NOT_ONBOARDING_REASON = "dealer-not-onboarding";
export const LIVE_ORDER_RECONCILED_FINDING = "live-order-reconciled";

const FAILED_LIVE_STATUSES = new Set<LiveListingStatus>(
  LIVE_LISTING_STATUSES.filter((status) => status !== "pass"),
);

export interface ProductionLiveExclusion {
  dealerKey: string;
  identityKey: string;
  title: string | null;
  sourceUrl: string | null;
  reasons: string[];
  findings: string[];
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

export function normalizeLiveIdentity(identityKey: string) {
  const match = /^(stockId|sourceVehicleId):(.+)$/i.exec(identityKey);
  if (!match) return identityKey.trim().toLowerCase();
  return `sourceVehicleId:${match[2]!.trim().toLowerCase().replace(/\s+/g, "")}`;
}

export function identitiesMatch(left: string, right: string) {
  return normalizeLiveIdentity(left) === normalizeLiveIdentity(right);
}

export function liveVisualStatusReason(status: LiveListingStatus) {
  return `live-visual-status:${status}`;
}

function liveListingEvidence(
  listing: PlannedListing,
  observed: LiveVisualListingResult,
  extraReasons: string[] = [],
): ExcludedListingEvidence {
  return excludedListingEvidence({
    identityKey: listing.identityKey,
    sourceUrl: listing.sourceUrl,
    title: listing.listing.title,
    reasons: [
      LIVE_VISUAL_EXCLUDED_REASON,
      liveVisualStatusReason(observed.status),
      ...extraReasons,
    ],
    findings: [
      ...listing.findings,
      ...observed.findings,
      liveVisualStatusReason(observed.status),
    ],
  });
}

function mergeExcluded(
  existing: ExcludedListingEvidence[],
  incoming: ExcludedListingEvidence[],
) {
  const byIdentity = new Map<string, ExcludedListingEvidence>();
  for (const listing of [...existing, ...incoming]) {
    const key = normalizeLiveIdentity(listing.identityKey);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, listing);
      continue;
    }
    byIdentity.set(key, {
      ...previous,
      reasons: uniqueSorted([...previous.reasons, ...listing.reasons]),
      findings: uniqueSorted([...previous.findings, ...listing.findings]),
    });
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.identityKey.localeCompare(right.identityKey));
}

function reportListingsByIdentity(dealer: LiveVisualDealerResult) {
  const byIdentity = new Map<string, LiveVisualListingResult>();
  for (const listing of dealer.listings) {
    const key = normalizeLiveIdentity(listing.identityKey);
    if (byIdentity.has(key)) {
      throw new Error(
        `live-visual-listing-duplicate:${dealer.dealerKey}:${listing.identityKey}`,
      );
    }
    byIdentity.set(key, listing);
  }
  return byIdentity;
}

export const previewLiveFinalizationSchema = z.object({
  candidateRunId: z.string().min(1),
  candidateFingerprint: z.string().min(1),
  liveReportRunId: z.string().min(1),
  liveReportPlanFingerprint: z.string().min(1),
  liveReportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  liveReportCreatedAt: z.string().min(1),
});

export function assertFinalizedPreviewPlan(
  plan: PreviewPackAuditPlan,
): PreviewLiveFinalization {
  assertPlanIntegrity(plan);
  const parsed = previewLiveFinalizationSchema.safeParse(plan.liveFinalization);
  if (!parsed.success) {
    throw new Error(
      "Refusing production plan: preview plan is not live-finalized.",
    );
  }
  if (
    parsed.data.candidateRunId === plan.runId ||
    parsed.data.candidateFingerprint === plan.fingerprint
  ) {
    throw new Error(
      "Refusing production plan: live finalization must bind a distinct candidate.",
    );
  }
  if (
    parsed.data.liveReportRunId !== parsed.data.candidateRunId ||
    parsed.data.liveReportPlanFingerprint !== parsed.data.candidateFingerprint
  ) {
    throw new Error(
      "Refusing production plan: live report provenance does not match the candidate.",
    );
  }
  return parsed.data;
}

export function assertLiveReportCoversCandidatePlan(input: {
  candidate: PreviewPackAuditPlan;
  report: LiveVisualReport;
}) {
  assertPlanIntegrity(input.candidate);
  if (input.candidate.liveFinalization) {
    throw new Error("Refusing live finalization: candidate plan is already live-finalized.");
  }
  if (input.report.runId !== input.candidate.runId) {
    throw new Error("Refusing live finalization: report run ID does not match the candidate plan.");
  }
  if (input.report.planFingerprint !== input.candidate.fingerprint) {
    throw new Error(
      "Refusing live finalization: report fingerprint does not match the candidate plan.",
    );
  }
  const planKeys = input.candidate.actions.map((action) => action.dealerKey);
  const reportKeys = input.report.dealers.map((dealer) => dealer.dealerKey);
  if (new Set(planKeys).size !== planKeys.length) {
    throw new Error("Refusing live finalization: candidate plan has duplicate dealer actions.");
  }
  if (new Set(reportKeys).size !== reportKeys.length) {
    throw new Error("Refusing live finalization: live report has duplicate dealers.");
  }
  if (
    planKeys.length !== reportKeys.length ||
    planKeys.some((key) => !reportKeys.includes(key)) ||
    reportKeys.some((key) => !planKeys.includes(key))
  ) {
    throw new Error("Refusing live finalization: every plan action and report dealer must be covered.");
  }

  const dealers = new Map(
    input.report.dealers.map((dealer) => [dealer.dealerKey, dealer]),
  );
  for (const action of input.candidate.actions) {
    const dealer = dealers.get(action.dealerKey);
    if (!dealer) {
      throw new Error(`Refusing live finalization: missing dealer coverage (${action.dealerKey}).`);
    }
    if (dealer.actionKind !== action.kind) {
      throw new Error(
        `Refusing live finalization: action kind mismatch (${action.dealerKey}).`,
      );
    }
    if (action.kind !== "replace") continue;
    const observed = reportListingsByIdentity(dealer);
    for (const listing of action.listings) {
      if (!observed.has(normalizeLiveIdentity(listing.identityKey))) {
        throw new Error(
          `Refusing live finalization: listing is not covered (${action.dealerKey}:${listing.identityKey}).`,
        );
      }
    }
    for (const listing of dealer.listings) {
      if (
        !action.listings.some((planned) =>
          identitiesMatch(planned.identityKey, listing.identityKey))
      ) {
        throw new Error(
          `Refusing live finalization: unexpected live listing (${action.dealerKey}:${listing.identityKey}).`,
        );
      }
    }
  }
}

function finalizeReplaceAction(
  action: ReplacePackAction,
  dealer: LiveVisualDealerResult,
): PackAuditAction {
  const observed = reportListingsByIdentity(dealer);
  const retained: PlannedListing[] = [];
  const liveExcluded: ExcludedListingEvidence[] = [];
  const dealerNotOnboarding = isTemporaryExcludedProductionAccount(action.dealerKey);
  const effectiveHidePack =
    dealer.hidePack && !dealerCensusRecoveredAfterT0(dealer.census);
  const hideReasons = effectiveHidePack || dealerNotOnboarding
    ? uniqueSorted([
        ...(effectiveHidePack ? [LIVE_VISUAL_HIDE_PACK_REASON] : []),
        ...(dealerNotOnboarding ? [DEALER_NOT_ONBOARDING_REASON] : []),
        ...(dealer.hideReason ? [dealer.hideReason] : []),
      ])
    : [];
  let passCount = 0;

  for (const listing of action.listings) {
    const result = observed.get(normalizeLiveIdentity(listing.identityKey));
    if (!result) {
      throw new Error(
        `Refusing live finalization: listing is not covered (${action.dealerKey}:${listing.identityKey}).`,
      );
    }
    const reordered = reconcileLiveImageOrder(listing, result);
    const passed = result.status === "pass" || reordered !== null;
    if (passed) passCount += 1;
    if (!passed || effectiveHidePack || dealerNotOnboarding) {
      liveExcluded.push(liveListingEvidence(listing, result, hideReasons));
      continue;
    }
    retained.push(reordered ?? listing);
  }

  const excludedListings = mergeExcluded(action.excludedListings, liveExcluded);
  if (effectiveHidePack || dealerNotOnboarding || passCount === 0) {
    return {
      kind: "disable",
      dealerKey: action.dealerKey,
      displayName: action.displayName,
      sourceRunId: action.sourceRunId,
      baseline: action.baseline,
      removeListings: true,
      reasons: uniqueSorted([
        ...hideReasons,
        ...(passCount === 0 && !effectiveHidePack
          ? [LIVE_VISUAL_NO_VALIDATED_LISTINGS_REASON]
          : []),
      ]),
      excludedListings,
    };
  }
  return {
    ...action,
    listings: retained,
    excludedListings,
  };
}

export function reconcileLiveImageOrder(
  listing: PlannedListing,
  result: LiveVisualListingResult,
): PlannedListing | null {
  if (
    result.status !== "drift" ||
    result.findings.length !== 1 ||
    result.findings[0] !== "live-drift" ||
    !result.heroSrc
  ) {
    return null;
  }
  const byIdentity = new Map<string, PlannedListing["images"][number]>();
  for (const image of listing.images) {
    const identity = galleryIdentityKey(image.sourceUrl);
    if (!identity || byIdentity.has(identity)) return null;
    byIdentity.set(identity, image);
  }
  const heroIdentity = galleryIdentityKey(result.heroSrc);
  if (!heroIdentity || !byIdentity.has(heroIdentity)) return null;
  const ordered: PlannedListing["images"] = [];
  const used = new Set<string>();
  for (const url of result.gallerySrcs) {
    const identity = galleryIdentityKey(url);
    const image = identity ? byIdentity.get(identity) : null;
    if (!identity || !image) return null;
    if (used.has(identity)) continue;
    used.add(identity);
    ordered.push(image);
  }
  if (ordered.length === 0) return null;
  for (const image of listing.images) {
    const identity = galleryIdentityKey(image.sourceUrl);
    if (!identity || used.has(identity)) continue;
    used.add(identity);
    ordered.push(image);
  }
  if (ordered.length !== listing.images.length) return null;
  return {
    ...listing,
    listing: {
      ...listing.listing,
      imageUrls: ordered.map((image) => image.sourceUrl),
    },
    images: ordered.map((image, order) => ({ ...image, order })),
    findings: uniqueSorted([
      ...listing.findings,
      LIVE_ORDER_RECONCILED_FINDING,
    ]),
  };
}

function finalizeDisableAction(
  action: DisablePackAction,
  dealer: LiveVisualDealerResult,
): DisablePackAction {
  const liveExcluded = dealer.listings
    .filter((listing) => FAILED_LIVE_STATUSES.has(listing.status) || dealer.hidePack)
    .map((listing) => excludedListingEvidence({
      identityKey: listing.identityKey,
      sourceUrl: listing.planned.sourceUrl,
      title: listing.planned.title,
      reasons: [
        LIVE_VISUAL_EXCLUDED_REASON,
        liveVisualStatusReason(listing.status),
        ...(dealer.hidePack ? [LIVE_VISUAL_HIDE_PACK_REASON] : []),
      ],
      findings: [...listing.findings, liveVisualStatusReason(listing.status)],
    }));
  return {
    ...action,
    excludedListings: mergeExcluded(action.excludedListings, liveExcluded),
  };
}

export function finalizePreviewActionFromLiveDealer(
  action: PackAuditAction,
  dealer: LiveVisualDealerResult,
): PackAuditAction {
  if (action.dealerKey !== dealer.dealerKey) {
    throw new Error("Refusing live finalization: dealer key mismatch.");
  }
  return action.kind === "disable"
    ? finalizeDisableAction(action, dealer)
    : finalizeReplaceAction(action, dealer);
}

export function finalizePreviewPlanFromLiveVisual(input: {
  candidate: PreviewPackAuditPlan;
  report: LiveVisualReport;
  finalRunId: string;
  createdAt?: string;
}): PreviewPackAuditPlan {
  if (!input.finalRunId.trim()) {
    throw new Error("Refusing live finalization: final run ID is required.");
  }
  if (input.finalRunId === input.candidate.runId) {
    throw new Error("Refusing live finalization: final run ID must differ from the candidate run.");
  }
  const report = parseLiveVisualReport(input.report);
  assertLiveReportCoversCandidatePlan({ candidate: input.candidate, report });
  const dealers = new Map(
    report.dealers.map((dealer) => [dealer.dealerKey, dealer]),
  );
  const actions = input.candidate.actions.map((action) =>
    finalizePreviewActionFromLiveDealer(action, dealers.get(action.dealerKey)!));
  return sealPlan({
    version: input.candidate.version,
    runId: input.finalRunId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    target: input.candidate.target,
    backupId: input.candidate.backupId,
    sourceRunId: input.candidate.sourceRunId,
    adminUserId: input.candidate.adminUserId,
    actionCount: actions.length,
    actions,
    liveFinalization: {
      candidateRunId: input.candidate.runId,
      candidateFingerprint: input.candidate.fingerprint,
      liveReportRunId: report.runId,
      liveReportPlanFingerprint: report.planFingerprint,
      liveReportFingerprint: report.fingerprint,
      liveReportCreatedAt: report.createdAt,
    },
  });
}

export const LIVE_ALLOWLIST_UNMATCHED_REASON = "live-allowlist-unmatched";
export const LIVE_PREVIEW_DISABLED_REASON = "live-preview-disabled";
export const LIVE_PREVIEW_DEALER_MISSING_REASON = "live-preview-dealer-missing";

export function isSyntheticLiveIdentity(identityKey: string) {
  const key = identityKey.trim().toLowerCase();
  return key === "pack-unverified" || key.startsWith("baseline:");
}

export function identityKeyVariants(identityKey: string) {
  const values = new Set<string>([identityKey, normalizeLiveIdentity(identityKey)]);
  const stock = extractStockIdFromIdentity(identityKey);
  if (stock) {
    values.add(`stockId:${stock}`);
    values.add(`sourceVehicleId:${stock}`);
  }
  return [...values];
}

export function liveListingRefsMatch(
  left: { identityKey: string; managedKey?: string; sourceUrl: string | null },
  right: { identityKey: string; managedKey?: string; sourceUrl: string | null },
) {
  if (identitiesMatch(left.identityKey, right.identityKey)) return true;
  if (left.managedKey && identitiesMatch(left.managedKey, right.identityKey)) return true;
  if (right.managedKey && identitiesMatch(right.managedKey, left.identityKey)) return true;
  if (
    left.managedKey &&
    right.managedKey &&
    identitiesMatch(left.managedKey, right.managedKey)
  ) {
    return true;
  }
  const leftUrl = canonicalizeLiveUrl(left.sourceUrl);
  const rightUrl = canonicalizeLiveUrl(right.sourceUrl);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;
  const leftStock = extractStockId(left.identityKey, left.sourceUrl);
  const rightStock = extractStockId(right.identityKey, right.sourceUrl);
  return Boolean(leftStock && rightStock && leftStock === rightStock);
}

export interface ProductionLiveAllowlistListing {
  dealerKey: string;
  identityKey: string;
  sourceUrl: string | null;
  title: string | null;
}

export interface ProductionLiveBaselineRef {
  listingId: string;
  managedKey: string;
  slug: string | null;
  status: string;
  title: string;
}

export interface ProductionLiveGate {
  sourceRunId: string;
  finalRunId: string;
  finalFingerprint: string;
  exclusions: ProductionLiveExclusion[];
  allowlist: ProductionLiveAllowlistListing[];
  disabledDealerKeys: string[];
  coveredDealerKeys: string[];
}

export function liveExclusionsFromFinalPreviewPlan(
  plan: PreviewPackAuditPlan,
): ProductionLiveExclusion[] {
  return plan.actions.flatMap((action) => {
    if (!ALLOWED_PRODUCTION_LIVE_DEALERS.has(action.dealerKey)) return [];
    return action.excludedListings
      .filter((listing) => !isSyntheticLiveIdentity(listing.identityKey))
      .map((listing) => ({
        dealerKey: action.dealerKey,
        identityKey: listing.identityKey,
        title: listing.title,
        sourceUrl: listing.sourceUrl,
        reasons: listing.reasons,
        findings: listing.findings,
      }));
  });
}

export function liveAllowlistFromFinalPreviewPlan(
  plan: PreviewPackAuditPlan,
): ProductionLiveAllowlistListing[] {
  return plan.actions.flatMap((action) => {
    if (!ALLOWED_PRODUCTION_LIVE_DEALERS.has(action.dealerKey)) return [];
    if (action.kind !== "replace") return [];
    return action.listings
      .filter((listing) => !isSyntheticLiveIdentity(listing.identityKey))
      .map((listing) => ({
        dealerKey: action.dealerKey,
        identityKey: listing.identityKey,
        sourceUrl: listing.sourceUrl,
        title: listing.listing.title,
      }));
  });
}

export function productionLiveGateFromFinalPreviewPlan(
  plan: PreviewPackAuditPlan,
): ProductionLiveGate {
  assertFinalizedPreviewPlan(plan);
  const coveredDealerKeys = uniqueSorted(
    plan.actions
      .filter((action) => ALLOWED_PRODUCTION_LIVE_DEALERS.has(action.dealerKey))
      .map((action) => action.dealerKey),
  );
  return {
    sourceRunId: plan.sourceRunId,
    finalRunId: plan.runId,
    finalFingerprint: plan.fingerprint,
    exclusions: liveExclusionsFromFinalPreviewPlan(plan),
    allowlist: liveAllowlistFromFinalPreviewPlan(plan),
    disabledDealerKeys: uniqueSorted(
      plan.actions
        .filter((action) =>
          action.kind === "disable" &&
          ALLOWED_PRODUCTION_LIVE_DEALERS.has(action.dealerKey))
        .map((action) => action.dealerKey),
    ),
    coveredDealerKeys,
  };
}

export function liveExclusionsFromVisualReport(
  report: LiveVisualReport,
): ProductionLiveExclusion[] {
  return report.dealers.flatMap((dealer) => {
    if (!ALLOWED_PRODUCTION_LIVE_DEALERS.has(dealer.dealerKey)) return [];
    return dealer.listings
      .filter((listing) =>
        dealer.hidePack || FAILED_LIVE_STATUSES.has(listing.status))
      .map((listing) => ({
        dealerKey: dealer.dealerKey,
        identityKey: listing.identityKey,
        title: listing.planned.title,
        sourceUrl: listing.planned.sourceUrl,
        reasons: uniqueSorted([
          LIVE_VISUAL_EXCLUDED_REASON,
          liveVisualStatusReason(listing.status),
          ...(dealer.hidePack ? [LIVE_VISUAL_HIDE_PACK_REASON] : []),
        ]),
        findings: uniqueSorted([
          ...listing.findings,
          liveVisualStatusReason(listing.status),
        ]),
      }));
  });
}

function baselineMatchesLiveRef(
  ref: { identityKey: string; sourceUrl: string | null },
  baseline: ProductionLiveBaselineRef,
  dealerKey: string,
  sourceKind?: ProductionSourceKind,
) {
  if (identitiesMatch(ref.identityKey, baseline.managedKey)) return true;
  if (baseline.slug && identitiesMatch(ref.identityKey, baseline.slug)) return true;
  const variants = identityKeyVariants(ref.identityKey);
  if (sourceKind === "founding") {
    return variants.some((identity) =>
      foundingListingSlug(dealerKey, identity) === baseline.slug);
  }
  if (sourceKind === "ocean") {
    return variants.some((identity) => oceanManagedKey(identity) === baseline.slug);
  }
  return false;
}

function mergeExcludedEvidence(listings: ProductionExcludedListing[]) {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    const key = `${normalizeLiveIdentity(listing.identityKey)}\0${listing.managedKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludeSourceListing(
  listing: ProductionSourceListing,
  extraReasons: string[],
  extraFindings: string[] = [],
): ProductionExcludedListing {
  const base = productionExcludedFromSource(listing);
  return {
    ...base,
    reasons: uniqueSorted([...extraReasons]),
    findings: uniqueSorted([...base.findings, ...extraFindings]),
  };
}

export function applyProductionLiveGate(input: {
  dealerKey: string;
  sourceKind?: ProductionSourceKind;
  source: ProductionSourceListing[];
  excludedListings: ProductionExcludedListing[];
  exclusions: ProductionLiveExclusion[];
  allowlist?: ProductionLiveAllowlistListing[] | null;
  disabled?: boolean;
  baseline?: ProductionLiveBaselineRef[] | null;
}): {
  source: ProductionSourceListing[];
  excludedListings: ProductionExcludedListing[];
  blockers: string[];
} {
  if (isTemporaryExcludedProductionAccount(input.dealerKey)) {
    return {
      source: input.source,
      excludedListings: input.excludedListings,
      blockers: [],
    };
  }

  const relevantExclusions = input.exclusions.filter((exclusion) =>
    exclusion.dealerKey === input.dealerKey &&
    !isTemporaryExcludedProductionAccount(exclusion.dealerKey) &&
    !isSyntheticLiveIdentity(exclusion.identityKey));
  const relevantAllowlist = (input.allowlist ?? []).filter((listing) =>
    listing.dealerKey === input.dealerKey &&
    !isSyntheticLiveIdentity(listing.identityKey));
  const baseline = input.baseline ?? [];

  if (input.disabled) {
    const fromSource = input.source.map((listing) =>
      excludeSourceListing(listing, [
        LIVE_PREVIEW_DISABLED_REASON,
        LIVE_VISUAL_EXCLUDED_REASON,
      ]));
    return {
      source: [],
      excludedListings: mergeExcludedEvidence([
        ...input.excludedListings,
        ...fromSource,
      ]),
      blockers: [],
    };
  }

  const keptAfterExclusions: ProductionSourceListing[] = [];
  const fromSource: ProductionExcludedListing[] = [];
  for (const listing of input.source) {
    const matched = relevantExclusions.filter((exclusion) =>
      liveListingRefsMatch(exclusion, listing));
    if (matched.length === 0) {
      keptAfterExclusions.push(listing);
      continue;
    }
    fromSource.push(excludeSourceListing(
      listing,
      [...matched.flatMap((item) => item.reasons), LIVE_VISUAL_EXCLUDED_REASON],
      matched.flatMap((item) => item.findings),
    ));
  }

  const blockers: string[] = [];
  const evidence = [...input.excludedListings, ...fromSource];
  for (const exclusion of relevantExclusions) {
    const mappedToSource = input.source.some((listing) =>
      liveListingRefsMatch(exclusion, listing)) ||
      evidence.some((listing) => liveListingRefsMatch(exclusion, listing));
    const mappedToBaseline = baseline.some((listing) =>
      baselineMatchesLiveRef(exclusion, listing, input.dealerKey, input.sourceKind));
    if (!mappedToSource && !mappedToBaseline) {
      blockers.push(`live-exclusion-unmapped:${exclusion.identityKey}`);
    }
  }

  let kept = keptAfterExclusions;
  if (input.allowlist) {
    const allowed: ProductionSourceListing[] = [];
    for (const listing of keptAfterExclusions) {
      if (relevantAllowlist.some((item) => liveListingRefsMatch(item, listing))) {
        allowed.push(listing);
        continue;
      }
      const onBaseline = baseline.some((item) =>
        item.managedKey === listing.managedKey ||
        baselineMatchesLiveRef(listing, item, input.dealerKey, input.sourceKind));
      if (onBaseline) {
        fromSource.push(excludeSourceListing(listing, [
          LIVE_ALLOWLIST_UNMATCHED_REASON,
          LIVE_VISUAL_EXCLUDED_REASON,
        ]));
      } else {
        blockers.push(`unmatched-production-source:${listing.identityKey}`);
      }
    }
    kept = allowed;
  }

  return {
    source: kept,
    excludedListings: mergeExcludedEvidence([
      ...input.excludedListings,
      ...fromSource,
    ]),
    blockers: uniqueSorted(blockers),
  };
}

export function applyLiveExclusionsToProductionAccount(input: {
  dealerKey: string;
  sourceKind?: ProductionSourceKind;
  source: ProductionSourceListing[];
  excludedListings: ProductionExcludedListing[];
  liveExclusions: ProductionLiveExclusion[];
  allowlist?: ProductionLiveAllowlistListing[] | null;
  disabled?: boolean;
  baseline?: ProductionLiveBaselineRef[] | null;
}) {
  return applyProductionLiveGate({
    dealerKey: input.dealerKey,
    sourceKind: input.sourceKind,
    source: input.source,
    excludedListings: input.excludedListings,
    exclusions: input.liveExclusions,
    allowlist: input.allowlist,
    disabled: input.disabled,
    baseline: input.baseline,
  });
}

const productionLiveExclusionSchema = z.object({
  dealerKey: z.string().min(1),
  identityKey: z.string().min(1),
  title: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  reasons: z.array(z.string()),
  findings: z.array(z.string()),
});

export const productionLiveExclusionsDocumentSchema = z.object({
  candidateRunId: z.string().min(1),
  candidateFingerprint: z.string().min(1),
  finalRunId: z.string().min(1),
  finalFingerprint: z.string().min(1),
  exclusions: z.array(productionLiveExclusionSchema),
});

export type ProductionLiveExclusionsDocument = z.infer<
  typeof productionLiveExclusionsDocumentSchema
>;

const ALLOWED_PRODUCTION_LIVE_DEALERS = new Set<string>(
  PRODUCTION_ACCOUNTS.map((account) => account.dealerKey),
);

export function parseProductionLiveExclusionsDocument(
  value: unknown,
): ProductionLiveExclusionsDocument {
  return productionLiveExclusionsDocumentSchema.parse(value);
}

function canonicalLiveExclusions(items: ProductionLiveExclusion[]) {
  return [...items]
    .map((item) => ({
      dealerKey: item.dealerKey,
      identityKey: item.identityKey,
      title: item.title,
      sourceUrl: item.sourceUrl,
      reasons: uniqueSorted(item.reasons),
      findings: uniqueSorted(item.findings),
    }))
    .sort((left, right) =>
      `${left.dealerKey}\0${left.identityKey}`
        .localeCompare(`${right.dealerKey}\0${right.identityKey}`));
}

export function assertProductionLiveExclusionsProvenance(input: {
  document: ProductionLiveExclusionsDocument;
  finalPlan: PreviewPackAuditPlan;
}): ProductionLiveExclusion[] {
  const liveFinalization = assertFinalizedPreviewPlan(input.finalPlan);
  if (
    input.document.finalRunId !== input.finalPlan.runId ||
    input.document.finalFingerprint !== input.finalPlan.fingerprint ||
    input.document.candidateRunId !== liveFinalization.candidateRunId ||
    input.document.candidateFingerprint !== liveFinalization.candidateFingerprint
  ) {
    throw new Error(
      "Refusing production live exclusions: document does not match the final preview plan.",
    );
  }
  const derived = liveExclusionsFromFinalPreviewPlan(input.finalPlan);
  for (const exclusion of input.document.exclusions) {
    if (isTemporaryExcludedProductionAccount(exclusion.dealerKey)) {
      throw new Error(
        `Refusing production live exclusions: ${exclusion.dealerKey} is excluded.`,
      );
    }
    if (!ALLOWED_PRODUCTION_LIVE_DEALERS.has(exclusion.dealerKey)) {
      throw new Error(
        `Refusing production live exclusions: ${exclusion.dealerKey} is not an included production account.`,
      );
    }
    if (
      !derived.some((listing) =>
        listing.dealerKey === exclusion.dealerKey &&
        identitiesMatch(listing.identityKey, exclusion.identityKey))
    ) {
      throw new Error(
        `Refusing production live exclusions: ${exclusion.dealerKey}:${exclusion.identityKey} is not in the final preview plan.`,
      );
    }
  }
  if (
    JSON.stringify(canonicalLiveExclusions(input.document.exclusions)) !==
    JSON.stringify(canonicalLiveExclusions(derived))
  ) {
    throw new Error(
      "Refusing production live exclusions: sidecar does not exactly match the finalized preview plan.",
    );
  }
  return derived;
}
