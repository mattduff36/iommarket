import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectUsableArchivedImages } from "@/scripts/dealer-pack-audit-sync/classify";
import {
  findSnapshotVehicle,
  reviewIdentityKeys,
  usedReviewIdentities,
} from "@/scripts/dealer-pack-audit-sync/review-identity";
import {
  buildReviewActionsFromAudit,
  removeSharedReviewImages,
  reconstructReviewListings,
} from "@/scripts/dealer-pack-audit-sync/review-plan";
import {
  REVIEW_APPLY_CONFIRM_PHRASE,
  assertNoRexDealerKey,
  assertReviewApplySafety,
  assertReviewPlanIntegrity,
  sealReviewPlan,
} from "@/scripts/dealer-pack-audit-sync/review-safety";
import {
  CANONICAL_AUDIT_PLAN_RELATIVE,
  CANONICAL_REVIEW_LISTING_COUNT,
  CANONICAL_REVIEW_SOURCE_RUN_ID,
  CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
  DEALER_PACK_REVIEW_VERSION,
  type PlannedReviewListing,
  type PreviewReviewPlan,
} from "@/scripts/dealer-pack-audit-sync/review-types";
import type { PackBaseline, PreviewPackAuditPlan } from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_CONFIRM_DB } from "@/scripts/dealer-pack-audit-sync/safety";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "@/scripts/wipe-preview-marketplace/target";
import { vehicle } from "./dealer-stock-sync/fixtures";
import type { ArchivedVehicle } from "@/scripts/dealer-stock-sync/types";
import { assertReviewApplyCanResume } from "@/scripts/dealer-pack-review-sync";
import { verifyPreviewReviewPlan } from "@/scripts/dealer-pack-audit-sync/review-verify";
import {
  reviewListingsNeedingUpload,
  reviewUploadAttemptId,
} from "@/scripts/dealer-pack-audit-sync/review-apply";

function archived(
  identityKey: string,
  overrides: Partial<ArchivedVehicle> = {},
  vehicleOverrides: Parameters<typeof vehicle>[0] = {},
): ArchivedVehicle {
  const raw = vehicle({
    sourceVehicleId: identityKey.includes(":") ? identityKey.slice(identityKey.indexOf(":") + 1) : identityKey,
    ...vehicleOverrides,
  });
  return {
    identityKey,
    identityKind: identityKey.startsWith("detailUrl:") ? "detailUrl" : "sourceVehicleId",
    sources: ["stock"],
    preferredSource: "stock",
    vehicle: raw,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: `hash-${identityKey}`,
    importable: true,
    importSkipReason: null,
    images: [],
    ...overrides,
  };
}

function baseline(enabled = false): PackBaseline {
  return {
    packId: "pack-1",
    dealerProfileId: "dealer-1",
    sourceRunId: "pack-source",
    enabled,
    updatedAt: "2026-09-30T12:00:00.000Z",
    listings: [],
  };
}

function plannedListing(identityKey: string): PlannedReviewListing {
  return {
    identityKey,
    snapshotIdentityKey: identityKey.replace("stockId:", "sourceVehicleId:"),
    sourceUrl: "https://dealer.example/car",
    title: "2022 Ford Focus ST-Line",
    reasons: ["listing-has-no-valid-source-image"],
    findings: [],
    listing: {
      title: "2022 Ford Focus ST-Line",
      description: "A sufficiently detailed vehicle description.",
      pricePence: 1_850_000,
      categorySlug: "car",
      attributes: { make: "Ford", model: "Focus", year: "2022", mileage: "12000" },
      imageUrls: [],
    },
    images: [],
  };
}

function unsignedReviewPlan(
  listings = Array.from({ length: CANONICAL_REVIEW_LISTING_COUNT }, (_, index) =>
    plannedListing(`sourceVehicleId:${index + 1}`)),
): Omit<PreviewReviewPlan, "fingerprint"> {
  return {
    version: DEALER_PACK_REVIEW_VERSION,
    kind: "preview-review",
    runId: "review-run-1",
    createdAt: "2026-09-30T20:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: "pmr-2026-09-30T19-00-00-000Z-preview",
    sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
    auditPlanPath: CANONICAL_AUDIT_PLAN_RELATIVE,
    auditPlanFingerprint: "audit-fingerprint",
    adminUserId: "admin-1",
    actionCount: 1,
    listingCount: listings.length,
    unclassifiedImportableCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
    actions: [{
      dealerKey: "athol-garage",
      displayName: "Athol Garage",
      keepEnabled: false,
      packSourceRunId: "pack-source",
      reviewSourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
      reviewReasons: ["listing-has-no-valid-source-image"],
      baseline: baseline(false),
      listings,
    }],
  };
}

function auditPlan(actions: PreviewPackAuditPlan["actions"]): PreviewPackAuditPlan {
  return {
    version: 1,
    runId: "audit-run",
    createdAt: "2026-09-30T14:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: "pmr-2026-09-30T13-00-00-000Z-preview",
    sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
    adminUserId: "admin-1",
    actionCount: actions.length,
    actions,
    fingerprint: "unused",
  };
}

function loader(byDealer: Record<string, ArchivedVehicle[]>) {
  return {
    loadVehicles(dealerKey: string) {
      return byDealer[dealerKey] ?? [];
    },
  };
}

describe("preview review identity mapping", () => {
  it("maps Ocean stockId keys onto sourceVehicleId snapshot records", () => {
    expect([...reviewIdentityKeys("stockId:21491569")].sort()).toEqual([
      "sourceVehicleId:21491569",
      "stockId:21491569",
    ]);
    const match = findSnapshotVehicle(
      [archived("sourceVehicleId:21491569", {}, { sourceVehicleId: "21491569" })],
      "stockId:21491569",
    );
    expect(match?.identityKey).toBe("sourceVehicleId:21491569");
  });

  it("does not treat pack-unverified or Rex identities as used review keys", () => {
    expect(usedReviewIdentities("ocean-motor-village", "pack-unverified").size).toBe(0);
    expect(usedReviewIdentities("rex-motor-company", "sourceVehicleId:1").size).toBe(0);
  });
});

describe("preview review reconstruction", () => {
  const vehicles = {
    "ocean-motor-village": [
      archived("sourceVehicleId:kept-1", {}, { sourceVehicleId: "kept-1" }),
      archived("sourceVehicleId:review-1", {}, { sourceVehicleId: "review-1" }),
      archived("sourceVehicleId:leftover-1", {}, { sourceVehicleId: "leftover-1" }),
    ],
    "athol-garage": [
      archived("sourceVehicleId:athol-review", {}, { sourceVehicleId: "athol-review", dealerKey: "athol-garage" }),
    ],
    "rex-motor-company": [
      archived("sourceVehicleId:rex-1", {}, { sourceVehicleId: "rex-1", dealerKey: "rex-motor-company" }),
    ],
  };

  const plan = auditPlan([
    {
      kind: "replace",
      dealerKey: "ocean-motor-village",
      displayName: "Ocean Motor Village",
      sourceRunId: "ocean-synthetic",
      baseline: baseline(true),
      listings: [{
        identityKey: "stockId:kept-1",
        sourceUrl: null,
        listing: plannedListing("stockId:kept-1").listing,
        images: [{
          sourceUrl: "https://cdn.example.com/a.jpg",
          localPath: "/tmp/a.jpg",
          checksum: "abc",
          width: 1200,
          height: 800,
          format: "jpg",
          bytes: 80_000,
          order: 0,
        }],
        findings: [],
      }],
      excludedListings: [{
        identityKey: "stockId:review-1",
        sourceUrl: "https://ocean.example/review-1",
        title: "Review Ocean",
        reasons: ["listing-has-no-valid-source-image"],
        findings: ["image-rejected:0:unusable-or-duplicate"],
      }],
    },
    {
      kind: "disable",
      dealerKey: "athol-garage",
      displayName: "Athol Garage",
      sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
      baseline: baseline(false),
      removeListings: true,
      reasons: ["source-snapshot-missing"],
      excludedListings: [{
        identityKey: "sourceVehicleId:athol-review",
        sourceUrl: null,
        title: "Athol review",
        reasons: ["listing-has-no-valid-source-image"],
        findings: [],
      }, {
        identityKey: "pack-unverified",
        sourceUrl: null,
        title: null,
        reasons: ["pack-unverified"],
        findings: [],
      }],
    },
    {
      kind: "disable",
      dealerKey: "rex-motor-company",
      displayName: "Rex Motor Company",
      sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
      baseline: baseline(false),
      removeListings: true,
      reasons: ["dealer-not-onboarding"],
      excludedListings: [{
        identityKey: "sourceVehicleId:rex-1",
        sourceUrl: null,
        title: "Rex",
        reasons: ["dealer-not-onboarding"],
        findings: [],
      }],
    },
  ]);

  it("reconstructs only explicit non-Rex exclusions and permits zero-image rows", () => {
    const result = reconstructReviewListings({
      auditPlan: plan,
      loader: loader(vehicles),
      expectedListingCount: 2,
      expectedUnclassifiedCount: 1,
    });
    expect(result.listings.map((listing) => listing.identityKey).sort()).toEqual([
      "sourceVehicleId:athol-review",
      "stockId:review-1",
    ]);
    expect(result.listings.every((listing) => listing.images.length === 0)).toBe(true);
    expect(result.unclassified).toEqual([
      { dealerKey: "ocean-motor-village", identityKey: "sourceVehicleId:leftover-1" },
    ]);
    expect(result.listings.some((listing) => listing.identityKey.includes("rex"))).toBe(false);
    expect(result.listings.some((listing) => listing.identityKey === "pack-unverified")).toBe(false);
  });

  it("drops image bytes shared by more than one review listing", () => {
    const image = {
      sourceUrl: "https://dealer.example/car.jpg",
      localPath: "archive/car.jpg",
      checksum: "shared-checksum",
      width: 1200,
      height: 800,
      format: "jpg",
      bytes: 80_000,
      order: 0,
    };
    const listings = [
      { ...plannedListing("stockId:1"), dealerKey: "athol-garage", images: [image] },
      { ...plannedListing("stockId:2"), dealerKey: "athol-garage", images: [image] },
    ];
    removeSharedReviewImages(listings);
    expect(listings.every((listing) => listing.images.length === 0)).toBe(true);
    expect(listings.every((listing) =>
      listing.findings.includes("image-rejected:shared-checksum:shared-checksum")))
      .toBe(true);
  });

  it("refuses a leftover count or listing-count mismatch", () => {
    expect(() => reconstructReviewListings({
      auditPlan: plan,
      loader: loader(vehicles),
      expectedListingCount: CANONICAL_REVIEW_LISTING_COUNT,
      expectedUnclassifiedCount: 1,
    })).toThrow("expected 164 review listings, got 2");
    expect(() => reconstructReviewListings({
      auditPlan: plan,
      loader: loader(vehicles),
      expectedListingCount: 2,
      expectedUnclassifiedCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
    })).toThrow("unclassified importable leftovers");
  });

  it("refuses a missing snapshot and Rex dealer keys", () => {
    expect(() => reconstructReviewListings({
      auditPlan: auditPlan([{
        kind: "disable",
        dealerKey: "athol-garage",
        displayName: "Athol Garage",
        sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
        baseline: baseline(false),
        removeListings: true,
        reasons: [],
        excludedListings: [{
          identityKey: "sourceVehicleId:missing",
          sourceUrl: null,
          title: null,
          reasons: ["listing-has-no-valid-source-image"],
          findings: [],
        }],
      }]),
      loader: loader({ "athol-garage": [] }),
      expectedListingCount: 1,
    })).toThrow("missing snapshot");
    expect(() => assertNoRexDealerKey("rex-motor-company")).toThrow("Rex is archived");
  });

  it("keeps disabled packs disabled when binding review actions", () => {
    const reconstructed = reconstructReviewListings({
      auditPlan: plan,
      loader: loader(vehicles),
      expectedListingCount: 2,
      expectedUnclassifiedCount: 1,
    });
    const actions = buildReviewActionsFromAudit({
      auditPlan: plan,
      reconstructed: reconstructed.listings,
      packs: new Map([
        ["ocean-motor-village", {
          ...baseline(true),
          displayName: "Ocean Motor Village",
          packSourceRunId: "ocean-synthetic",
          keepEnabled: true,
        }],
        ["athol-garage", {
          ...baseline(false),
          displayName: "Athol Garage",
          packSourceRunId: "pack-source",
          keepEnabled: false,
        }],
      ]),
    });
    expect(actions.find((action) => action.dealerKey === "rex-motor-company")).toBeUndefined();
    expect(actions.find((action) => action.dealerKey === "ocean-motor-village")?.keepEnabled).toBe(true);
    expect(actions.find((action) => action.dealerKey === "athol-garage")?.keepEnabled).toBe(false);
    expect(actions.find((action) => action.dealerKey === "athol-garage")?.reviewReasons)
      .toContain("pack-unverified");
  });
});

describe("preview review plan safety", () => {
  const previewUrl = `postgresql://postgres@db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`;

  it("rejects a tampered fingerprint and production bindings", () => {
    const plan = sealReviewPlan(unsignedReviewPlan());
    expect(() => assertReviewPlanIntegrity(plan)).not.toThrow();
    plan.actions[0]!.displayName = "Tampered";
    expect(() => assertReviewPlanIntegrity(plan)).toThrow("fingerprint");

    const frozen = sealReviewPlan(unsignedReviewPlan());
    const argv = [
      "apply-preview",
      "--allow=1",
      `--preview-ref=${PREVIEW_PROJECT_REF}`,
      `--confirm-db=${PREVIEW_CONFIRM_DB}`,
      `--plan-fingerprint=${frozen.fingerprint}`,
      `--plan-count=${frozen.actionCount}`,
      `--confirm=${REVIEW_APPLY_CONFIRM_PHRASE}`,
      `--backup-id=${frozen.backupId}`,
    ];
    expect(() => assertReviewApplySafety({
      argv,
      plan: frozen,
      databaseUrl: previewUrl,
    })).not.toThrow();
    expect(() => assertReviewApplySafety({
      argv: [...argv, "--production-ref=anything"],
      plan: frozen,
      databaseUrl: previewUrl,
    })).toThrow("production flags");
    expect(() => assertReviewApplySafety({
      argv,
      plan: frozen,
      databaseUrl: `postgresql://postgres@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
    })).toThrow("production database URL");
  });

  it("rejects Rex, placeholder listings, and enabled-state drift in a frozen plan", () => {
    expect(() => assertReviewPlanIntegrity(sealReviewPlan({
      ...unsignedReviewPlan(),
      actions: [{
        ...unsignedReviewPlan().actions[0]!,
        dealerKey: "rex-motor-company",
      }],
    }))).toThrow("Rex is archived");

    const leaked = unsignedReviewPlan();
    leaked.actions[0]!.listings[0]!.identityKey = "pack-unverified";
    expect(() => assertReviewPlanIntegrity(sealReviewPlan(leaked))).toThrow("pack-unverified");

    const drifted = unsignedReviewPlan();
    drifted.actions[0]!.keepEnabled = true;
    expect(() => assertReviewPlanIntegrity(sealReviewPlan(drifted))).toThrow("keepEnabled");
  });

  it("drops placeholder/unusable recorded images", () => {
    const inspected = inspectUsableArchivedImages([{
      originalUrl: "https://example.com/themes/placeholder.png",
      localPath: null,
      contentType: "image/png",
      bytes: 12,
      checksum: "dead",
      status: "ok",
      error: null,
    }]);
    expect(inspected.images).toEqual([]);
    expect(inspected.findings[0]).toContain("image-rejected");
  });

  it("does not re-upload reused listings and gives each upload a unique attempt ID", () => {
    const listings = [plannedListing("stockId:1"), plannedListing("stockId:2")];
    expect(reviewListingsNeedingUpload(listings, ["stockId:1"]))
      .toEqual([listings[1]]);
    const first = reviewUploadAttemptId("review-run");
    const second = reviewUploadAttemptId("review-run");
    expect(first).not.toBe(second);
    expect(first.startsWith("review-run-")).toBe(true);
  });

  it("resumes a partial apply report but refuses mismatched or completed reports", () => {
    const plan = sealReviewPlan(unsignedReviewPlan());
    const partial = {
      runId: plan.runId,
      planFingerprint: plan.fingerprint,
      createdAt: "2026-09-30T20:10:00.000Z",
      results: [{
        dealerKey: "athol-garage",
        status: "failed" as const,
        keepEnabled: false,
        listingCount: 0,
      }],
    };
    expect(() => assertReviewApplyCanResume(partial, plan)).not.toThrow();
    expect(() => assertReviewApplyCanResume({
      ...partial,
      planFingerprint: "wrong",
    }, plan)).toThrow("does not match");
    expect(() => assertReviewApplyCanResume({
      ...partial,
      results: [{
        dealerKey: "athol-garage",
        status: "applied" as const,
        keepEnabled: false,
        listingCount: CANONICAL_REVIEW_LISTING_COUNT,
      }],
    }, plan)).toThrow("already completed");
  });

  it("verifies exact review identities without enabling a disabled pack", async () => {
    const plan = sealReviewPlan(unsignedReviewPlan());
    let listingStatus = "ADMIN_PREVIEW";
    const applied = {
      dealerKey: "athol-garage",
      status: "applied" as const,
      keepEnabled: false,
      listingCount: CANONICAL_REVIEW_LISTING_COUNT,
      listings: [],
    };
    const prisma = {
      adminAuditLog: {
        findFirst: async () => ({ details: applied }),
      },
      dealerPreviewPack: {
        findUnique: async () => ({
          enabled: false,
          reviewState: "NEEDS_REVIEW",
          reviewSourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
          listings: plan.actions[0]!.listings.map((listing, index) => ({
            id: `listing-${index}`,
            status: listingStatus,
            reviewSourceIdentity: listing.identityKey,
            images: [],
          })),
        }),
        findMany: async () => Array.from({ length: 35 }, (_, index) => ({
          dealerKey: index === 0 ? "athol-garage" : `review-pack-${index}`,
          displayName: index === 0 ? "Athol Garage" : `Review Pack ${index}`,
          enabled: false,
          reviewState: index === 0 ? "NEEDS_REVIEW" : "NONE",
          reviewReasons: index === 0 ? ["manual-review"] : [],
          listings: index === 0
            ? plan.actions[0]!.listings.map(() => ({
                reviewState: "NEEDS_REVIEW",
                images: [],
              }))
            : [],
        })),
      },
    };
    const report = await verifyPreviewReviewPlan({
      prisma: prisma as never,
      plan,
      applyReport: {
        runId: plan.runId,
        planFingerprint: plan.fingerprint,
        createdAt: "2026-09-30T20:20:00.000Z",
        results: [applied],
      },
    });

    expect(report.ok).toBe(true);
    expect(report.listingCount).toBe(CANONICAL_REVIEW_LISTING_COUNT);
    expect(report.packCount).toBe(35);
    expect(report.results[0]).toMatchObject({
      enabled: false,
      zeroImageCount: CANONICAL_REVIEW_LISTING_COUNT,
    });

    listingStatus = "LIVE";
    const unsafe = await verifyPreviewReviewPlan({
      prisma: prisma as never,
      plan,
      applyReport: {
        runId: plan.runId,
        planFingerprint: plan.fingerprint,
        createdAt: "2026-09-30T20:20:00.000Z",
        results: [applied],
      },
    });
    expect(unsafe.ok).toBe(false);
    expect(unsafe.results[0]?.errors[0]).toContain("review-listing-status");
  });
});

describe("canonical preview review artifacts", () => {
  it("always enforces the 164 review and 106 unclassified reconstruction contract", () => {
    const reviewIds = Array.from(
      { length: CANONICAL_REVIEW_LISTING_COUNT },
      (_, index) => `sourceVehicleId:review-${index + 1}`,
    );
    const leftoverIds = Array.from(
      { length: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT },
      (_, index) => `sourceVehicleId:leftover-${index + 1}`,
    );
    const syntheticPlan = auditPlan([{
      kind: "disable",
      dealerKey: "athol-garage",
      displayName: "Athol Garage",
      sourceRunId: CANONICAL_REVIEW_SOURCE_RUN_ID,
      baseline: baseline(false),
      removeListings: true,
      reasons: ["manual-review"],
      excludedListings: reviewIds.map((identityKey) => ({
        identityKey,
        sourceUrl: null,
        title: null,
        reasons: ["listing-has-no-valid-source-image"],
        findings: [],
      })),
    }]);
    const result = reconstructReviewListings({
      auditPlan: syntheticPlan,
      loader: loader({
        "athol-garage": [...reviewIds, ...leftoverIds].map((identityKey) =>
          archived(identityKey, {}, {
            dealerKey: "athol-garage",
            sourceVehicleId: identityKey.slice("sourceVehicleId:".length),
          })),
      }),
      expectedListingCount: CANONICAL_REVIEW_LISTING_COUNT,
      expectedUnclassifiedCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
    });

    expect(result.listings).toHaveLength(CANONICAL_REVIEW_LISTING_COUNT);
    expect(result.unclassified).toHaveLength(CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT);
  });

  it.skipIf(!existsSync(CANONICAL_AUDIT_PLAN_RELATIVE))(
    "reconstructs exactly 164 non-Rex exclusions and 106 leftovers",
    async () => {
      const { readCanonicalAuditPlan, createArchiveVehicleLoader, reconstructReviewListings: reconstruct } =
        await import("@/scripts/dealer-pack-audit-sync/review-plan");
      const { listArchivedDealerKeys } = await import("@/lib/preview-packs/archive");
      const auditPlanJson = readCanonicalAuditPlan();
      const result = reconstruct({
        auditPlan: auditPlanJson,
        loader: createArchiveVehicleLoader(CANONICAL_REVIEW_SOURCE_RUN_ID),
        expectedListingCount: CANONICAL_REVIEW_LISTING_COUNT,
        expectedUnclassifiedCount: CANONICAL_UNCLASSIFIED_IMPORTABLE_COUNT,
        dealerKeys: [
          ...new Set([
            ...auditPlanJson.actions.map((action) => action.dealerKey),
            ...listArchivedDealerKeys(CANONICAL_REVIEW_SOURCE_RUN_ID),
          ]),
        ],
      });
      expect(result.listings).toHaveLength(164);
      expect(result.unclassified).toHaveLength(106);
      expect(result.listings.some((listing) => listing.identityKey === "pack-unverified")).toBe(false);
      expect(result.listings.some((listing) => /rex/i.test(listing.identityKey))).toBe(false);
      expect(result.listings.filter((listing) => listing.identityKey.startsWith("stockId:")))
        .toHaveLength(12);
    },
  );
});
