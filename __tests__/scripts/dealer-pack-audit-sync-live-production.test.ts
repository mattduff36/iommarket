import { describe, expect, it } from "vitest";
import {
  LIVE_ALLOWLIST_UNMATCHED_REASON,
  LIVE_PREVIEW_DISABLED_REASON,
  LIVE_VISUAL_EXCLUDED_REASON,
  applyProductionLiveGate,
  assertFinalizedPreviewPlan,
  assertProductionLiveExclusionsProvenance,
  finalizePreviewPlanFromLiveVisual,
  liveAllowlistFromFinalPreviewPlan,
  liveExclusionsFromFinalPreviewPlan,
  liveListingRefsMatch,
  parseProductionLiveExclusionsDocument,
  productionLiveGateFromFinalPreviewPlan,
} from "@/scripts/dealer-pack-audit-sync/finalize-live";
import {
  loadCliProductionLiveExclusions,
} from "@/scripts/dealer-pack-audit-sync/finalize-live-cli";
import { sealPlan } from "@/scripts/dealer-pack-audit-sync/plan-file";
import {
  FOUNDING_IMPORT_NOTES,
  planManagedNamespace,
} from "@/scripts/dealer-pack-audit-sync/production-baseline";
import {
  assertProductionSourceRunBinding,
  productionLiveBaselineRefs,
} from "@/scripts/dealer-pack-audit-sync/production-plan";
import { oceanManagedKey } from "@/scripts/dealer-pack-audit-sync/production-source";
import {
  PRODUCTION_ACCOUNTS,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  type ProductionAccountBaseline,
  type ProductionListingBaseline,
  type ProductionSourceListing,
} from "@/scripts/dealer-pack-audit-sync/production-types";
import { PREVIEW_CONFIRM_DB } from "@/scripts/dealer-pack-audit-sync/safety";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
  type PlannedListing,
  type PreviewPackAuditPlan,
  type ReplacePackAction,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { buildLiveDealerCensus } from "@/scripts/dealer-pack-audit-sync/live-census";
import { buildLiveVisualReport } from "@/scripts/dealer-pack-audit-sync/live-report";
import { plannedLiveIdentity } from "@/scripts/dealer-pack-audit-sync/live-match";
import type {
  LiveListingStatus,
  LiveVisualDealerResult,
  LiveVisualListingResult,
} from "@/scripts/dealer-pack-audit-sync/live-types";

const founding = PRODUCTION_ACCOUNTS[0]!;

function plannedListing(
  identityKey: string,
  sourceUrl = `https://dealer.example/used/${identityKey}`,
): PlannedListing {
  return {
    identityKey,
    sourceUrl,
    listing: {
      title: "2024 Example Car",
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
    sourceRunId: "source-run-reviewed",
    baseline: {
      packId: "pack-1",
      dealerProfileId: "dealer-1",
      sourceRunId: "old-run",
      enabled: true,
      updatedAt: "2026-09-28T20:00:00.000Z",
      listings: [],
    },
    listings,
    excludedListings: [],
  };
}

function candidatePlan(actions: PreviewPackAuditPlan["actions"]) {
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

function liveListing(
  listing: PlannedListing,
  status: LiveListingStatus,
): LiveVisualListingResult {
  return {
    identityKey: listing.identityKey,
    status,
    hidePack: status === "inaccessible",
    planned: plannedLiveIdentity(listing),
    observed: null,
    match: {
      url: false,
      stockId: false,
      title: false,
      price: false,
      stockIdConflict: false,
      titleConflict: false,
      priceConflict: false,
      assignedBy: null,
    },
    heroSrc: null,
    gallerySrcs: [],
    imageSignals: [],
    findings: [],
    evidencePaths: { stockCard: null, detail: null, images: [] },
  };
}

function liveDealer(
  dealerKey: string,
  listings: LiveVisualListingResult[],
  hidePack = false,
): LiveVisualDealerResult {
  return {
    dealerKey,
    displayName: dealerKey,
    actionKind: "replace",
    hidePack,
    hideReason: hidePack ? "listing-inaccessible" : null,
    census: buildLiveDealerCensus({
      dealerKey,
      plannedCount: listings.length,
      matchedCount: listings.filter((listing) => listing.status === "pass").length,
      extraObservedCount: 0,
      t0Accessible: !hidePack,
      t0PageUrl: "https://dealer.example/used",
      t0CardCount: listings.length,
      t1Attempted: listings.length,
      t1AccessibleCount: hidePack ? 0 : listings.length,
      t1InaccessibleCount: hidePack ? listings.length : 0,
    }),
    listings,
    evidenceDir: `live-visual/${dealerKey}`,
  };
}

function finalizeReplace(
  dealerKey: string,
  listings: Array<{ listing: PlannedListing; status: LiveListingStatus }>,
  hidePack = false,
) {
  const planned = listings.map((item) => item.listing);
  const candidate = candidatePlan([replaceAction(dealerKey, planned)]);
  return finalizePreviewPlanFromLiveVisual({
    candidate,
    report: buildLiveVisualReport({
      runId: candidate.runId,
      planFingerprint: candidate.fingerprint,
      createdAt: "2026-09-29T21:10:00.000Z",
      dealers: [liveDealer(
        dealerKey,
        listings.map((item) => liveListing(item.listing, item.status)),
        hidePack,
      )],
    }),
    finalRunId: "run-final",
  });
}

function event(fromStatus: string | null, toStatus: string, action: string) {
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
  account = founding,
): ProductionAccountBaseline {
  return {
    user: {
      id: "user-1",
      authUserId: "auth-1",
      email: account.email,
      role: "DEALER",
      updatedAt: "2026-09-28T20:00:00.000Z",
    },
    dealer: {
      id: "dealer-1",
      userId: "user-1",
      name: account.displayName,
      slug: account.dealerKey,
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

function sidecarDocument(finalPlan: PreviewPackAuditPlan) {
  const liveFinalization = assertFinalizedPreviewPlan(finalPlan);
  return {
    candidateRunId: liveFinalization.candidateRunId,
    candidateFingerprint: liveFinalization.candidateFingerprint,
    finalRunId: finalPlan.runId,
    finalFingerprint: finalPlan.fingerprint,
    exclusions: liveExclusionsFromFinalPreviewPlan(finalPlan),
  };
}

describe("production live-run binding", () => {
  it("rejects an optional live-run bypass", async () => {
    await expect(loadCliProductionLiveExclusions({ argv: [] }))
      .rejects.toThrow("--live-run or a sealed finalized preview plan is required");
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-exclusions=sidecar/live-exclusions.json"],
    })).rejects.toThrow("--live-run or a sealed finalized preview plan is required");
  });

  it("rejects a candidate preview plan through --live-run and --live-plan", async () => {
    const candidate = candidatePlan([
      replaceAction("athol-garage", [plannedListing("stockId:abc123")]),
    ]);
    expect(candidate.liveFinalization).toBeUndefined();
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-run=run-candidate"],
      cwd: "/workspace",
      readPlan: async () => candidate,
    })).rejects.toThrow("preview plan is not live-finalized");
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-plan=private/dealer-pack-audit/run-candidate/preview-plan.json"],
      cwd: "/workspace",
      readPlan: async () => candidate,
    })).rejects.toThrow("preview plan is not live-finalized");
  });

  it("loads a sealed --live-run plan and rejects a run-id mismatch", async () => {
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: plannedListing("stockId:abc123"), status: "mismatch" },
    ]);
    const document = sidecarDocument(finalPlan);
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-run=run-final", "--live-exclusions=sidecar/live-exclusions.json"],
      cwd: "/workspace",
      readText: async () => JSON.stringify(document),
      readPlan: async () => finalPlan,
    })).resolves.toMatchObject({ exclusions: document.exclusions });
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-run=run-other"],
      cwd: "/workspace",
      readPlan: async () => finalPlan,
    })).rejects.toThrow("--live-run does not match the finalized preview plan");
  });

  it("keeps a missing sidecar from downgrading a finalized preview plan", async () => {
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: plannedListing("stockId:abc123"), status: "mismatch" },
    ]);
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-run=run-final"],
      cwd: "/workspace",
      readPlan: async () => finalPlan,
      readText: async () => {
        throw missing;
      },
    })).resolves.toMatchObject({
      exclusions: liveExclusionsFromFinalPreviewPlan(finalPlan),
      gate: expect.objectContaining({
        finalRunId: finalPlan.runId,
        finalFingerprint: finalPlan.fingerprint,
      }),
    });
  });

  it("rejects an edited-down exclusions sidecar", () => {
    const pass = plannedListing("stockId:pass");
    const fail = plannedListing("stockId:fail");
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: pass, status: "pass" },
      { listing: fail, status: "mismatch" },
    ]);
    const derived = liveExclusionsFromFinalPreviewPlan(finalPlan);
    expect(derived).toHaveLength(1);
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: parseProductionLiveExclusionsDocument({
          ...sidecarDocument(finalPlan),
          exclusions: [],
        }),
        finalPlan,
      }),
    ).toThrow("does not exactly match");
  });

  it("rejects sidecar provenance that is remapped, tampered, or off-allowlist", () => {
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: plannedListing("stockId:abc123"), status: "mismatch" },
    ]);
    const exclusions = liveExclusionsFromFinalPreviewPlan(finalPlan);
    const document = parseProductionLiveExclusionsDocument(sidecarDocument(finalPlan));
    expect(assertProductionLiveExclusionsProvenance({ document, finalPlan }))
      .toEqual(exclusions);
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: {
          ...document,
          exclusions: [{ ...exclusions[0]!, identityKey: "sourceVehicleId:abc123" }],
        },
        finalPlan,
      }),
    ).toThrow("does not exactly match");
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: { ...document, finalFingerprint: "tampered" },
        finalPlan,
      }),
    ).toThrow("does not match the final preview plan");
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: { ...document, candidateFingerprint: "tampered" },
        finalPlan,
      }),
    ).toThrow("does not match the final preview plan");
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: {
          ...document,
          exclusions: [{
            ...exclusions[0]!,
            dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
          }],
        },
        finalPlan,
      }),
    ).toThrow("rex-motor-company is excluded");
    expect(() =>
      assertProductionLiveExclusionsProvenance({
        document: {
          ...document,
          exclusions: [{ ...exclusions[0]!, dealerKey: "island-cars" }],
        },
        finalPlan,
      }),
    ).toThrow("is not an included production account");
  });

  it("rejects a founding source run that does not match the finalized preview plan", () => {
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: plannedListing("stockId:pass"), status: "pass" },
    ]);
    expect(finalPlan.sourceRunId).toBe("source-run-reviewed");
    expect(() =>
      assertProductionSourceRunBinding("other-source-run", finalPlan),
    ).toThrow("does not match finalized preview plan sourceRunId");
    expect(() =>
      assertProductionSourceRunBinding(finalPlan.sourceRunId, finalPlan),
    ).not.toThrow();
  });

  it("rejects tampered live-finalization provenance on a sealed preview plan", async () => {
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: plannedListing("stockId:abc123"), status: "mismatch" },
    ]);
    const liveFinalization = assertFinalizedPreviewPlan(finalPlan);
    expect(liveFinalization).toMatchObject({
      candidateRunId: "run-candidate",
      candidateFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      liveReportRunId: "run-candidate",
      liveReportFingerprint: liveFinalization.candidateFingerprint,
    });
    const tampered = {
      ...finalPlan,
      liveFinalization: {
        ...liveFinalization,
        candidateFingerprint: "tampered-candidate-fingerprint",
      },
    };
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-run=run-final"],
      cwd: "/workspace",
      readPlan: async () => tampered,
    })).rejects.toThrow("fingerprint is invalid");
    await expect(loadCliProductionLiveExclusions({
      argv: ["--live-plan=private/dealer-pack-audit/run-final/preview-plan.json"],
      cwd: "/workspace",
      readPlan: async () => tampered,
    })).rejects.toThrow("fingerprint is invalid");
    const { fingerprint: _ignored, ...unsigned } = finalPlan;
    const resealedForgery = sealPlan({
      ...unsigned,
      liveFinalization: {
        ...liveFinalization,
        candidateFingerprint: "tampered-candidate-fingerprint",
      },
    });
    expect(() => assertFinalizedPreviewPlan(resealedForgery)).toThrow(
      "live report provenance does not match the candidate",
    );
  });
});

describe("production live allowlist and disable", () => {
  it("never creates or updates an unmatched production source listing", () => {
    const kept = plannedListing("stockId:keep");
    const extra = plannedListing("stockId:extra");
    const finalPlan = finalizeReplace("athol-garage", [
      { listing: kept, status: "pass" },
      { listing: extra, status: "pass" },
    ]);
    const gate = productionLiveGateFromFinalPreviewPlan(finalPlan);
    const unmatched = productionSource({
      identityKey: "stockId:stranger",
      managedKey: "fd-athol-garage-stranger",
      sourceUrl: "https://dealer.example/used/stranger",
      slug: "fd-athol-garage-stranger",
    });
    const allowed = productionSource({
      identityKey: "stockId:keep",
      sourceUrl: kept.sourceUrl,
    });
    const gated = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [allowed, unmatched],
      excludedListings: [],
      exclusions: gate.exclusions,
      allowlist: gate.allowlist,
      baseline: productionLiveBaselineRefs(founding, accountBaseline([managedListing()])),
    });
    expect(gated.source.map((listing) => listing.identityKey)).toEqual(["stockId:keep"]);
    expect(gated.blockers).toContain("unmatched-production-source:stockId:stranger");
    expect(gated.source.some((listing) => listing.identityKey === "stockId:stranger"))
      .toBe(false);

    const staleUnmatched = productionSource({
      identityKey: "stockId:stale",
      managedKey: managedListing().slug!,
      sourceUrl: "https://dealer.example/used/stale",
    });
    const takeDown = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [staleUnmatched],
      excludedListings: [],
      exclusions: [],
      allowlist: liveAllowlistFromFinalPreviewPlan(finalPlan),
      baseline: productionLiveBaselineRefs(founding, accountBaseline([managedListing()])),
    });
    expect(takeDown.source).toEqual([]);
    expect(takeDown.excludedListings[0]?.reasons).toContain(LIVE_ALLOWLIST_UNMATCHED_REASON);
    expect(planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing()]),
      source: takeDown.source,
    }).actions).toEqual([
      expect.objectContaining({ kind: "take_down", listingId: "listing-1" }),
    ]);
  });

  it("takes down every managed listing when the finalized preview dealer is disabled", () => {
    const keep = plannedListing("stockId:keep");
    const finalPlan = finalizeReplace(
      "athol-garage",
      [{ listing: keep, status: "pass" }],
      true,
    );
    const gate = productionLiveGateFromFinalPreviewPlan(finalPlan);
    expect(gate.disabledDealerKeys).toContain("athol-garage");
    const second = managedListing({
      id: "listing-2",
      slug: `fd-athol-garage-${"b".repeat(32)}`,
    });
    const gated = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [productionSource()],
      excludedListings: [],
      exclusions: gate.exclusions,
      allowlist: gate.allowlist,
      disabled: true,
      baseline: productionLiveBaselineRefs(
        founding,
        accountBaseline([managedListing(), second]),
      ),
    });
    expect(gated.source).toEqual([]);
    expect(gated.excludedListings[0]?.reasons).toContain(LIVE_PREVIEW_DISABLED_REASON);
    expect(planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing(), second]),
      source: gated.source,
    }).actions.map((action) => action.kind)).toEqual(["take_down", "take_down"]);
  });

  it("matches Ocean listings by normalized identity and source URL", () => {
    const preview = plannedListing(
      "stockId:21911132",
      "https://www.oceanford.com/used-cars/21911132/",
    );
    const finalPlan = finalizeReplace("ocean-motor-village", [
      { listing: preview, status: "pass" },
    ]);
    const source = productionSource({
      identityKey: "sourceVehicleId:21911132",
      managedKey: oceanManagedKey("sourceVehicleId:21911132"),
      sourceUrl: "https://www.oceanford.com/used-cars/21911132/?utm_source=ad",
      slug: oceanManagedKey("sourceVehicleId:21911132"),
    });
    expect(liveListingRefsMatch(preview, source)).toBe(true);
    const gated = applyProductionLiveGate({
      dealerKey: "ocean-motor-village",
      sourceKind: "ocean",
      source: [source],
      excludedListings: [],
      exclusions: [],
      allowlist: liveAllowlistFromFinalPreviewPlan(finalPlan),
      baseline: [],
    });
    expect(gated.source).toHaveLength(1);
    expect(gated.blockers).toEqual([]);
  });

  it("keeps excluded listings durably taken down and never recreates them", () => {
    const listing = plannedListing("stockId:abc123");
    const finalPlan = finalizeReplace("athol-garage", [
      { listing, status: "mismatch" },
    ]);
    const gate = productionLiveGateFromFinalPreviewPlan(finalPlan);
    const source = productionSource();
    const first = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [source],
      excludedListings: [],
      exclusions: gate.exclusions,
      allowlist: gate.allowlist,
      baseline: productionLiveBaselineRefs(founding, accountBaseline([managedListing()])),
    });
    expect(first.source).toEqual([]);
    expect(first.excludedListings[0]).toMatchObject({
      identityKey: "stockId:abc123",
      managedKey: source.managedKey,
    });
    expect(first.excludedListings[0]?.reasons).toContain(LIVE_VISUAL_EXCLUDED_REASON);
    const takeDown = planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing()]),
      source: first.source,
    });
    expect(takeDown.actions).toEqual([
      expect.objectContaining({ kind: "take_down", listingId: "listing-1" }),
    ]);

    const replay = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [source],
      excludedListings: [],
      exclusions: gate.exclusions,
      allowlist: gate.allowlist,
      baseline: productionLiveBaselineRefs(
        founding,
        accountBaseline([managedListing({ status: "TAKEN_DOWN" })]),
      ),
    });
    expect(replay.source).toEqual([]);
    expect(planManagedNamespace({
      account: founding,
      baseline: accountBaseline([managedListing({ status: "TAKEN_DOWN" })]),
      source: replay.source,
    }).actions).toEqual([]);
  });

  it("blocks a live exclusion that cannot map to production source or baseline", () => {
    const gated = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [productionSource()],
      excludedListings: [],
      exclusions: [{
        dealerKey: "athol-garage",
        identityKey: "stockId:ghost",
        title: "Ghost",
        sourceUrl: "https://dealer.example/used/ghost",
        reasons: [LIVE_VISUAL_EXCLUDED_REASON],
        findings: [],
      }],
      allowlist: [{
        dealerKey: "athol-garage",
        identityKey: "stockId:abc123",
        sourceUrl: "https://dealer.example/used/abc123",
        title: "2024 Example Car",
      }],
      baseline: productionLiveBaselineRefs(founding, accountBaseline([managedListing()])),
    });
    expect(gated.blockers).toContain("live-exclusion-unmapped:stockId:ghost");
    expect(gated.excludedListings.some((listing) =>
      listing.identityKey === "stockId:ghost")).toBe(false);
  });

  it("filters synthetic baseline and pack-unverified identities", () => {
    const gated = applyProductionLiveGate({
      dealerKey: "athol-garage",
      sourceKind: "founding",
      source: [productionSource()],
      excludedListings: [],
      exclusions: [{
        dealerKey: "athol-garage",
        identityKey: "pack-unverified",
        title: "Athol Garage",
        sourceUrl: null,
        reasons: [LIVE_VISUAL_EXCLUDED_REASON],
        findings: ["unverified-no-source-identity"],
      }, {
        dealerKey: "athol-garage",
        identityKey: "baseline:listing-old",
        title: "listing-old",
        sourceUrl: null,
        reasons: [LIVE_VISUAL_EXCLUDED_REASON],
        findings: ["unverified-no-source-identity"],
      }],
      allowlist: [{
        dealerKey: "athol-garage",
        identityKey: "stockId:abc123",
        sourceUrl: "https://dealer.example/used/abc123",
        title: "2024 Example Car",
      }],
      baseline: [],
    });
    expect(gated.blockers).toEqual([]);
    expect(gated.source).toHaveLength(1);
  });
});
