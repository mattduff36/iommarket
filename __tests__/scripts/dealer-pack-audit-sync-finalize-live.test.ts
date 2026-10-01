import { describe, expect, it } from "vitest";
import { sealPlan } from "@/scripts/dealer-pack-audit-sync/plan-file";
import { assertPlanIntegrity } from "@/scripts/dealer-pack-audit-sync/plan-file";
import { CENSUS_DRIFT_HIDE_REASON, buildLiveDealerCensus } from "@/scripts/dealer-pack-audit-sync/live-census";
import { buildLiveVisualReport } from "@/scripts/dealer-pack-audit-sync/live-report";
import { plannedLiveIdentity } from "@/scripts/dealer-pack-audit-sync/live-match";
import type {
  LiveListingStatus,
  LiveVisualDealerResult,
  LiveVisualListingResult,
} from "@/scripts/dealer-pack-audit-sync/live-types";
import { liveVisualReportFingerprint } from "@/scripts/dealer-pack-audit-sync/live-types";
import {
  DEALER_NOT_ONBOARDING_REASON,
  LIVE_ORDER_RECONCILED_FINDING,
  LIVE_VISUAL_EXCLUDED_REASON,
  LIVE_VISUAL_HIDE_PACK_REASON,
  LIVE_VISUAL_NO_VALIDATED_LISTINGS_REASON,
  applyLiveExclusionsToProductionAccount,
  finalizePreviewPlanFromLiveVisual,
  liveExclusionsFromFinalPreviewPlan,
  liveVisualStatusReason,
  normalizeLiveIdentity,
} from "@/scripts/dealer-pack-audit-sync/finalize-live";
import {
  parseFinalizeLiveArgs,
  runFinalizeLiveCli,
} from "@/scripts/dealer-pack-audit-sync/finalize-live-cli";
import { planManagedNamespace } from "@/scripts/dealer-pack-audit-sync/production-baseline";
import {
  PRODUCTION_ACCOUNTS,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  type ProductionAccountBaseline,
  type ProductionListingBaseline,
  type ProductionSourceListing,
} from "@/scripts/dealer-pack-audit-sync/production-types";
import { FOUNDING_IMPORT_NOTES } from "@/scripts/dealer-pack-audit-sync/production-baseline";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
  type DisablePackAction,
  type PackBaseline,
  type PlannedListing,
  type PreviewPackAuditPlan,
  type ReplacePackAction,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_CONFIRM_DB } from "@/scripts/dealer-pack-audit-sync/safety";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

const founding = PRODUCTION_ACCOUNTS[0]!;

function baseline(): PackBaseline {
  return {
    packId: "pack-1",
    dealerProfileId: "dealer-1",
    sourceRunId: "old-run",
    enabled: true,
    updatedAt: "2026-09-28T20:00:00.000Z",
    listings: [],
  };
}

function plannedListing(
  identityKey: string,
  title = "2024 Example Car",
): PlannedListing {
  return {
    identityKey,
    sourceUrl: `https://dealer.example/used/${identityKey}`,
    listing: {
      title,
      description: "A sufficiently detailed vehicle description.",
      pricePence: 1_299_500,
      categorySlug: "car",
      attributes: { make: "Example" },
      imageUrls: ["https://cdn.example/car.jpg"],
    },
    images: [{
      sourceUrl: "https://cdn.example/car.jpg",
      localPath: "archive/car.jpg",
      checksum: "checksum-1",
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 100_000,
      order: 0,
    }],
    findings: [],
  };
}

function replaceAction(
  dealerKey: string,
  listings: PlannedListing[],
): ReplacePackAction {
  return {
    kind: "replace",
    dealerKey,
    displayName: dealerKey,
    sourceRunId: "source-run",
    baseline: baseline(),
    listings,
    excludedListings: [],
  };
}

function disableAction(dealerKey: string): DisablePackAction {
  return {
    kind: "disable",
    dealerKey,
    displayName: dealerKey,
    sourceRunId: "source-run",
    baseline: baseline(),
    removeListings: true,
    reasons: ["unsafe"],
    excludedListings: [],
  };
}

function candidatePlan(
  actions: PreviewPackAuditPlan["actions"],
): PreviewPackAuditPlan {
  return sealPlan({
    version: DEALER_PACK_AUDIT_VERSION,
    runId: "run-candidate",
    createdAt: "2026-09-29T21:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: REQUIRED_BACKUP_ID,
    sourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    actionCount: actions.length,
    actions,
  });
}

function emptyMatch(): LiveVisualListingResult["match"] {
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

function liveListing(
  listing: PlannedListing,
  status: LiveListingStatus,
  findings: string[] = [],
): LiveVisualListingResult {
  return {
    identityKey: listing.identityKey,
    status,
    hidePack: status === "inaccessible",
    planned: plannedLiveIdentity(listing),
    observed: null,
    match: emptyMatch(),
    heroSrc: null,
    gallerySrcs: [],
    imageSignals: [],
    findings,
    evidencePaths: { stockCard: null, detail: null, images: [] },
  };
}

function liveDealer(input: {
  dealerKey: string;
  actionKind: "replace" | "disable";
  listings: LiveVisualListingResult[];
  hidePack?: boolean;
  hideReason?: string | null;
  recoveredAfterT0?: boolean;
}): LiveVisualDealerResult {
  return {
    dealerKey: input.dealerKey,
    displayName: input.dealerKey,
    actionKind: input.actionKind,
    hidePack: input.hidePack === true,
    hideReason: input.hideReason ?? null,
    census: buildLiveDealerCensus({
      dealerKey: input.dealerKey,
      plannedCount: input.listings.length,
      matchedCount: input.listings.filter((listing) => listing.status === "pass").length,
      extraObservedCount: 0,
      t0Accessible: !input.hidePack,
      t0PageUrl: "https://dealer.example/used",
      t0CardCount: input.listings.length,
      t1Attempted: input.listings.length,
      t1AccessibleCount:
        input.hidePack && !input.recoveredAfterT0 ? 0 : input.listings.length,
      t1InaccessibleCount:
        input.hidePack && !input.recoveredAfterT0 ? input.listings.length : 0,
      t1ListAccessible: input.recoveredAfterT0,
    }),
    listings: input.listings,
    evidenceDir: `live-visual/${input.dealerKey}`,
  };
}

function reportFor(
  plan: PreviewPackAuditPlan,
  dealers: LiveVisualDealerResult[],
) {
  return buildLiveVisualReport({
    runId: plan.runId,
    planFingerprint: plan.fingerprint,
    createdAt: "2026-09-29T21:10:00.000Z",
    dealers,
  });
}

function event(
  fromStatus: string | null,
  toStatus: string,
  action: string,
) {
  return {
    id: `${fromStatus}-${toStatus}`,
    fromStatus,
    toStatus,
    changedByUserId: "admin-1",
    source: "ADMIN",
    action,
    notes: FOUNDING_IMPORT_NOTES,
    createdAt: "2026-09-28T20:00:00.000Z",
  };
}

function managedListing(
  overrides: Partial<ProductionListingBaseline> = {},
): ProductionListingBaseline {
  return {
    id: "listing-1",
    userId: "user-1",
    dealerId: "dealer-1",
    slug: `fd-athol-garage-${"a".repeat(32)}`,
    previewPackId: null,
    title: "2024 Example Car",
    description: "A complete example dealer vehicle description.",
    price: 1_000_000,
    status: "LIVE",
    featured: false,
    categorySlug: "car",
    regionSlug: "iom-south",
    expiresAt: "2026-10-28T20:00:00.000Z",
    trustDeclarationAccepted: true,
    trustDeclarationAcceptedAt: "2026-09-28T20:00:00.000Z",
    photoRevision: 0,
    lifecycleRevision: 0,
    updatedAt: "2026-09-28T20:00:00.000Z",
    attributes: [{ id: "attr-1", slug: "make", value: "Example" }],
    images: [{
      id: "image-1",
      url: "https://res.cloudinary.com/example/image.jpg",
      publicId: "iommarket/listings/founding/athol-garage/listing/0",
      provider: "CLOUDINARY",
      assetId: "asset-1",
      version: "1",
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 100_000,
      order: 0,
    }],
    statusEvents: [
      event(null, "DRAFT", "SYSTEM_BACKFILL"),
      event("DRAFT", "PENDING", "SUBMIT"),
      event("PENDING", "LIVE", "APPROVE"),
    ],
    revisions: [],
    ...overrides,
  };
}

function accountBaseline(
  rows: ProductionListingBaseline[],
): ProductionAccountBaseline {
  return {
    user: {
      id: "user-1",
      authUserId: "auth-1",
      email: founding.email,
      role: "DEALER",
      updatedAt: "2026-09-28T20:00:00.000Z",
    },
    dealer: {
      id: "dealer-1",
      userId: "user-1",
      name: founding.displayName,
      slug: founding.dealerKey,
      tier: "PRO",
      verified: true,
      isAdminPreview: false,
      updatedAt: "2026-09-28T20:00:00.000Z",
    },
    listings: rows,
  };
}

function productionSource(
  overrides: Partial<ProductionSourceListing> = {},
): ProductionSourceListing {
  return {
    identityKey: "stockId:abc123",
    managedKey: managedListing().slug!,
    sourceUrl: "https://dealer.example/used/abc123",
    slug: managedListing().slug,
    listing: {
      title: "2024 Example Car",
      description: "A complete example dealer vehicle description.",
      pricePence: 1_299_500,
      categorySlug: "car",
      regionSlug: "iom-south",
      attributes: { make: "Example" },
      imageUrls: ["https://stock.example/image.jpg"],
    },
    images: [{
      sourceUrl: "https://stock.example/image.jpg",
      localPath: "archive/image.jpg",
      checksum: "checksum-1",
      contentType: "image/jpeg",
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 100_000,
      order: 0,
    }],
    findings: [],
    ...overrides,
  };
}

describe("finalize live preview plans", () => {
  it("reseals a new run that keeps only pass listings and excludes live failures", () => {
    const pass = plannedListing("stockId:pass", "Pass Car");
    const mismatch = plannedListing("stockId:mis", "Mismatch Car");
    const placeholder = plannedListing("stockId:ph", "Placeholder Car");
    const empty = plannedListing("stockId:empty", "Empty Car");
    const drift = plannedListing("stockId:drift", "Drift Car");
    const inaccessible = plannedListing("stockId:down", "Down Car");
    const candidate = candidatePlan([
      replaceAction("athol-garage", [
        pass,
        mismatch,
        placeholder,
        empty,
        drift,
        inaccessible,
      ]),
    ]);
    const report = reportFor(candidate, [
      liveDealer({
        dealerKey: "athol-garage",
        actionKind: "replace",
        listings: [
          liveListing(pass, "pass"),
          liveListing(mismatch, "mismatch", ["title-conflict"]),
          liveListing(placeholder, "placeholder", ["placeholder-image"]),
          liveListing(empty, "empty", ["no-gallery"]),
          liveListing(drift, "drift", ["image-checksum-drift"]),
          liveListing(inaccessible, "inaccessible", ["detail-inaccessible"]),
        ],
      }),
    ]);

    const finalPlan = finalizePreviewPlanFromLiveVisual({
      candidate,
      report,
      finalRunId: "run-final",
      createdAt: "2026-09-29T22:00:00.000Z",
    });

    expect(finalPlan.runId).toBe("run-final");
    expect(finalPlan.runId).not.toBe(candidate.runId);
    expect(finalPlan.fingerprint).not.toBe(candidate.fingerprint);
    expect(candidate.liveFinalization).toBeUndefined();
    expect(finalPlan.liveFinalization).toEqual({
      candidateRunId: candidate.runId,
      candidateFingerprint: candidate.fingerprint,
      liveReportRunId: report.runId,
      liveReportPlanFingerprint: report.planFingerprint,
      liveReportFingerprint: report.fingerprint,
      liveReportCreatedAt: report.createdAt,
    });
    expect(() => assertPlanIntegrity(finalPlan)).not.toThrow();
    expect(finalPlan.actions).toHaveLength(1);
    expect(finalPlan.actions[0]).toMatchObject({
      kind: "replace",
      dealerKey: "athol-garage",
    });
    const action = finalPlan.actions[0] as ReplacePackAction;
    expect(action.listings.map((listing) => listing.identityKey)).toEqual(["stockId:pass"]);
    expect(action.excludedListings.map((listing) => listing.identityKey)).toEqual([
      "stockId:down",
      "stockId:drift",
      "stockId:empty",
      "stockId:mis",
      "stockId:ph",
    ]);
    expect(action.excludedListings.every((listing) =>
      listing.reasons.includes(LIVE_VISUAL_EXCLUDED_REASON))).toBe(true);
    expect(action.excludedListings.map((listing) => listing.findings).flat()).toEqual(
      expect.arrayContaining([
        "title-conflict",
        liveVisualStatusReason("mismatch"),
        liveVisualStatusReason("placeholder"),
        liveVisualStatusReason("empty"),
        liveVisualStatusReason("drift"),
        liveVisualStatusReason("inaccessible"),
      ]),
    );
  });

  it("reorders a fully matched gallery from independent live primary evidence", () => {
    const first = plannedListing("stockId:order");
    const secondImage = {
      ...first.images[0]!,
      sourceUrl: "https://cdn.example/rear.jpg",
      checksum: "checksum-2",
      order: 1,
    };
    const planned: PlannedListing = {
      ...first,
      listing: {
        ...first.listing,
        imageUrls: [first.images[0]!.sourceUrl, secondImage.sourceUrl],
      },
      images: [first.images[0]!, secondImage],
    };
    const candidate = candidatePlan([replaceAction("athol-garage", [planned])]);
    const observed: LiveVisualListingResult = {
      ...liveListing(planned, "drift", ["live-drift"]),
      heroSrc: secondImage.sourceUrl,
      gallerySrcs: [secondImage.sourceUrl, first.images[0]!.sourceUrl],
    };

    const finalPlan = finalizePreviewPlanFromLiveVisual({
      candidate,
      report: reportFor(candidate, [
        liveDealer({
          dealerKey: "athol-garage",
          actionKind: "replace",
          listings: [observed],
        }),
      ]),
      finalRunId: "run-live-order",
    });
    const action = finalPlan.actions[0] as ReplacePackAction;

    expect(action.listings[0]?.images.map((image) => image.sourceUrl)).toEqual([
      secondImage.sourceUrl,
      first.images[0]!.sourceUrl,
    ]);
    expect(action.listings[0]?.images.map((image) => image.order)).toEqual([0, 1]);
    expect(action.listings[0]?.findings).toContain(LIVE_ORDER_RECONCILED_FINDING);
    expect(action.excludedListings).toEqual([]);
  });

  it("reorders from a validated lazy-gallery prefix and preserves unseen source images", () => {
    const first = plannedListing("stockId:lazy-order");
    const secondImage = {
      ...first.images[0]!,
      sourceUrl: "https://cdn.example/rear.jpg",
      checksum: "checksum-2",
      order: 1,
    };
    const thirdImage = {
      ...first.images[0]!,
      sourceUrl: "https://cdn.example/interior.jpg",
      checksum: "checksum-3",
      order: 2,
    };
    const planned: PlannedListing = {
      ...first,
      listing: {
        ...first.listing,
        imageUrls: [
          first.images[0]!.sourceUrl,
          secondImage.sourceUrl,
          thirdImage.sourceUrl,
        ],
      },
      images: [first.images[0]!, secondImage, thirdImage],
    };
    const candidate = candidatePlan([replaceAction("td-car-centre", [planned])]);
    const observed: LiveVisualListingResult = {
      ...liveListing(planned, "drift", ["live-drift"]),
      heroSrc: secondImage.sourceUrl,
      gallerySrcs: [secondImage.sourceUrl, first.images[0]!.sourceUrl],
    };

    const finalPlan = finalizePreviewPlanFromLiveVisual({
      candidate,
      report: reportFor(candidate, [
        liveDealer({
          dealerKey: "td-car-centre",
          actionKind: "replace",
          listings: [observed],
        }),
      ]),
      finalRunId: "run-live-lazy-order",
    });
    const action = finalPlan.actions[0] as ReplacePackAction;

    expect(action.listings[0]?.images.map((image) => image.sourceUrl)).toEqual([
      secondImage.sourceUrl,
      first.images[0]!.sourceUrl,
      thirdImage.sourceUrl,
    ]);
    expect(action.listings[0]?.findings).toContain(LIVE_ORDER_RECONCILED_FINDING);
  });

  it("converts hidePack or unvalidated replace actions to disable/removeListings", () => {
    const keep = plannedListing("stockId:keep");
    const fail = plannedListing("stockId:fail");
    const hidden = candidatePlan([replaceAction("mikes-motors", [keep])]);
    const hiddenReport = reportFor(hidden, [
      liveDealer({
        dealerKey: "mikes-motors",
        actionKind: "replace",
        hidePack: true,
        hideReason: "listing-inaccessible",
        listings: [liveListing(keep, "pass")],
      }),
    ]);
    const hiddenFinal = finalizePreviewPlanFromLiveVisual({
      candidate: hidden,
      report: hiddenReport,
      finalRunId: "run-hidden",
    });
    expect(hiddenFinal.actions[0]).toMatchObject({
      kind: "disable",
      removeListings: true,
      dealerKey: "mikes-motors",
    });
    const hiddenAction = hiddenFinal.actions[0] as DisablePackAction;
    expect(hiddenAction.reasons).toEqual([
      "listing-inaccessible",
      LIVE_VISUAL_HIDE_PACK_REASON,
    ]);
    expect(hiddenAction.excludedListings[0]?.identityKey).toBe("stockId:keep");

    const empty = candidatePlan([replaceAction("td-car-centre", [fail])]);
    const emptyFinal = finalizePreviewPlanFromLiveVisual({
      candidate: empty,
      report: reportFor(empty, [
        liveDealer({
          dealerKey: "td-car-centre",
          actionKind: "replace",
          listings: [liveListing(fail, "empty", ["no-gallery"])],
        }),
      ]),
      finalRunId: "run-empty",
    });
    expect(emptyFinal.actions[0]).toMatchObject({
      kind: "disable",
      removeListings: true,
    });
    expect((emptyFinal.actions[0] as DisablePackAction).reasons).toContain(
      LIVE_VISUAL_NO_VALIDATED_LISTINGS_REASON,
    );

    const drifted = plannedListing("stockId:keep");
    const censusHidden = candidatePlan([replaceAction("island-cars", [drifted])]);
    const censusFinal = finalizePreviewPlanFromLiveVisual({
      candidate: censusHidden,
      report: reportFor(censusHidden, [
        liveDealer({
          dealerKey: "island-cars",
          actionKind: "replace",
          hidePack: true,
          hideReason: CENSUS_DRIFT_HIDE_REASON,
          listings: [liveListing(drifted, "drift", [CENSUS_DRIFT_HIDE_REASON])],
        }),
      ]),
      finalRunId: "run-census-drift",
    });
    expect(censusFinal.actions[0]).toMatchObject({
      kind: "disable",
      removeListings: true,
      dealerKey: "island-cars",
    });
    const censusAction = censusFinal.actions[0] as DisablePackAction;
    expect(censusAction.reasons).toEqual([
      CENSUS_DRIFT_HIDE_REASON,
      LIVE_VISUAL_HIDE_PACK_REASON,
    ]);
    expect(censusAction.excludedListings[0]?.reasons).toEqual(
      expect.arrayContaining([CENSUS_DRIFT_HIDE_REASON, LIVE_VISUAL_HIDE_PACK_REASON]),
    );
  });

  it("keeps disabled candidate actions disabled and refuses uncovered reports", () => {
    const disabled = candidatePlan([disableAction("ocean-motor-village")]);
    const kept = finalizePreviewPlanFromLiveVisual({
      candidate: disabled,
      report: reportFor(disabled, [
        liveDealer({
          dealerKey: "ocean-motor-village",
          actionKind: "disable",
          listings: [],
        }),
      ]),
      finalRunId: "run-disabled",
    });
    expect(kept.actions[0]).toMatchObject({
      kind: "disable",
      reasons: ["unsafe"],
      removeListings: true,
    });

    const replace = candidatePlan([replaceAction("athol-garage", [plannedListing("stockId:a")])]);
    const wrongRunReport = {
      ...reportFor(replace, [
        liveDealer({
          dealerKey: "athol-garage",
          actionKind: "replace",
          listings: [liveListing(plannedListing("stockId:a"), "pass")],
        }),
      ]),
      runId: "other-run",
    };
    wrongRunReport.fingerprint = liveVisualReportFingerprint(wrongRunReport);
    expect(() =>
      finalizePreviewPlanFromLiveVisual({
        candidate: replace,
        report: wrongRunReport,
        finalRunId: "run-bad",
      }),
    ).toThrow("run ID");
    expect(() =>
      finalizePreviewPlanFromLiveVisual({
        candidate: replace,
        report: reportFor(replace, [
          liveDealer({
            dealerKey: "mikes-motors",
            actionKind: "replace",
            listings: [],
          }),
        ]),
        finalRunId: "run-missing",
      }),
    ).toThrow("every plan action and report dealer must be covered");
    expect(() =>
      finalizePreviewPlanFromLiveVisual({
        candidate: replace,
        report: reportFor(replace, [
          liveDealer({
            dealerKey: "athol-garage",
            actionKind: "replace",
            listings: [liveListing(plannedListing("stockId:other"), "pass")],
          }),
        ]),
        finalRunId: "run-uncovered",
      }),
    ).toThrow("listing is not covered");
    expect(() =>
      finalizePreviewPlanFromLiveVisual({
        candidate: replace,
        report: reportFor(replace, [
          liveDealer({
            dealerKey: "athol-garage",
            actionKind: "replace",
            listings: [liveListing(plannedListing("stockId:a"), "pass")],
          }),
        ]),
        finalRunId: replace.runId,
      }),
    ).toThrow("final run ID must differ");
    const alreadyFinal = finalizePreviewPlanFromLiveVisual({
      candidate: replace,
      report: reportFor(replace, [
        liveDealer({
          dealerKey: "athol-garage",
          actionKind: "replace",
          listings: [liveListing(plannedListing("stockId:a"), "pass")],
        }),
      ]),
      finalRunId: "run-already-final",
    });
    expect(() =>
      finalizePreviewPlanFromLiveVisual({
        candidate: alreadyFinal,
        report: reportFor(alreadyFinal, [
          liveDealer({
            dealerKey: "athol-garage",
            actionKind: "replace",
            listings: [liveListing(plannedListing("stockId:a"), "pass")],
          }),
        ]),
        finalRunId: "run-again",
      }),
    ).toThrow("already live-finalized");
  });
});

describe("production live exclusions", () => {
  it("takes down validated-preview exclusions and does not reactivate taken-down listings", () => {
    const source = productionSource();
    const listing = plannedListing("stockId:abc123");
    const candidate = candidatePlan([replaceAction("athol-garage", [listing])]);
    const exclusions = liveExclusionsFromFinalPreviewPlan(
      finalizePreviewPlanFromLiveVisual({
        candidate,
        report: reportFor(candidate, [
          liveDealer({
            dealerKey: "athol-garage",
            actionKind: "replace",
            listings: [liveListing(listing, "mismatch")],
          }),
        ]),
        finalRunId: "run-prod-exclusions",
      }),
    );
    expect(normalizeLiveIdentity("stockId:abc123")).toBe(
      normalizeLiveIdentity("sourceVehicleId:abc123"),
    );

    const adjusted = applyLiveExclusionsToProductionAccount({
      dealerKey: "athol-garage",
      source: [source],
      excludedListings: [],
      liveExclusions: exclusions,
    });
    expect(adjusted.source).toEqual([]);
    expect(adjusted.excludedListings[0]).toMatchObject({
      identityKey: "stockId:abc123",
      managedKey: source.managedKey,
    });

    const takeDown = planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing()]),
      source: adjusted.source,
    });
    expect(takeDown.actions).toEqual([
      expect.objectContaining({
        kind: "take_down",
        listingId: "listing-1",
        fromStatus: "LIVE",
      }),
    ]);

    const alreadyDown = planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing({ status: "TAKEN_DOWN" })]),
      source: adjusted.source,
    });
    expect(alreadyDown.actions).toEqual([]);

    const rexIgnored = applyLiveExclusionsToProductionAccount({
      dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
      source: [source],
      excludedListings: [],
      liveExclusions: [{
        dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
        identityKey: "stockId:abc123",
        title: "Rex car",
        sourceUrl: null,
        reasons: [LIVE_VISUAL_EXCLUDED_REASON],
        findings: [],
      }],
    });
    expect(rexIgnored.source).toHaveLength(1);
  });

  it("disables Rex even when its public preview listings pass", () => {
    const candidate = candidatePlan([
      replaceAction(TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY, [
        plannedListing("stockId:rex"),
      ]),
    ]);
    const finalPlan = finalizePreviewPlanFromLiveVisual({
      candidate,
      report: reportFor(candidate, [
        liveDealer({
          dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
          actionKind: "replace",
          listings: [liveListing(plannedListing("stockId:rex"), "pass")],
        }),
      ]),
      finalRunId: "run-rex-preview",
    });
    expect(finalPlan.actions[0]).toMatchObject({
      kind: "disable",
      reasons: [DEALER_NOT_ONBOARDING_REASON],
      removeListings: true,
    });
    expect(liveExclusionsFromFinalPreviewPlan(finalPlan)).toEqual([]);
    expect(PRODUCTION_ACCOUNTS.map((account) => account.dealerKey)).not.toContain(
      TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
    );
  });

  it("retains a fully validated pack when T1 recovered a failed T0 census", () => {
    const listing = plannedListing("stockId:swift");
    const candidate = candidatePlan([replaceAction("swift-motors", [listing])]);
    const finalPlan = finalizePreviewPlanFromLiveVisual({
      candidate,
      report: reportFor(candidate, [
        liveDealer({
          dealerKey: "swift-motors",
          actionKind: "replace",
          listings: [liveListing(listing, "pass")],
          hidePack: true,
          hideReason: "dealer-site-inaccessible",
          recoveredAfterT0: true,
        }),
      ]),
      finalRunId: "run-swift-recovered",
    });

    expect(finalPlan.actions[0]).toMatchObject({
      kind: "replace",
      listings: [{ identityKey: "stockId:swift" }],
    });
  });
});

describe("finalize live CLI", () => {
  it("writes a normal preview-plan and live-exclusions sidecar", async () => {
    expect(() => parseFinalizeLiveArgs([])).toThrow("--final-run");
    const pass = plannedListing("stockId:pass");
    const fail = plannedListing("stockId:fail");
    const candidate = candidatePlan([replaceAction("athol-garage", [pass, fail])]);
    const report = reportFor(candidate, [
      liveDealer({
        dealerKey: "athol-garage",
        actionKind: "replace",
        listings: [
          liveListing(pass, "pass"),
          liveListing(fail, "drift", ["image-checksum-drift"]),
        ],
      }),
    ]);
    const written: string[] = [];
    const result = await runFinalizeLiveCli(
      ["--candidate-run=run-candidate", "--final-run=run-final"],
      {
        readPlan: async () => candidate,
        readReport: async () => report,
        writePlan: async (path, plan) => {
          written.push(path);
          expect(path).toContain("preview-plan.json");
          expect(plan.runId).toBe("run-final");
          expect(plan.liveFinalization).toEqual({
            candidateRunId: candidate.runId,
            candidateFingerprint: candidate.fingerprint,
            liveReportRunId: report.runId,
            liveReportPlanFingerprint: report.planFingerprint,
            liveReportFingerprint: report.fingerprint,
            liveReportCreatedAt: report.createdAt,
          });
          expect(() => assertPlanIntegrity(plan)).not.toThrow();
        },
        writeExclusions: async (path, value) => {
          written.push(path);
          expect(path).toContain("live-exclusions.json");
          expect(value).toEqual(expect.objectContaining({
            finalRunId: "run-final",
            exclusions: [
              expect.objectContaining({ identityKey: "stockId:fail" }),
            ],
          }));
        },
        now: () => "2026-09-29T22:00:00.000Z",
      },
    );
    expect(result.plan.actions[0]).toMatchObject({ kind: "replace" });
    expect(written).toHaveLength(2);
  });
});
