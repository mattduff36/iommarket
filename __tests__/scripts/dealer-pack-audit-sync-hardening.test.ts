import { describe, expect, it } from "vitest";
import { assertReplaceListingsHaveImages } from "@/scripts/dealer-pack-audit-sync/apply";
import {
  classifySnapshot,
  NO_VALID_SOURCE_IMAGE_REASON,
} from "@/scripts/dealer-pack-audit-sync/classify";
import {
  assertPlanIntegrity,
  assertProductionPlanIntegrity,
  sealPlan,
  sealProductionPlan,
} from "@/scripts/dealer-pack-audit-sync/plan-file";
import { assertProductionActionHasImages } from "@/scripts/dealer-pack-audit-sync/production-apply";
import {
  FOUNDING_IMPORT_NOTES,
  planManagedNamespace,
} from "@/scripts/dealer-pack-audit-sync/production-baseline";
import {
  partitionProductionSourceListings,
  productionExcludedFromSource,
  removeDuplicateSourceImages,
} from "@/scripts/dealer-pack-audit-sync/production-source";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_AUDIT_VERSION,
  PRODUCTION_BACKUP_ID,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  isTemporaryExcludedProductionAccount,
  type ProductionAccountBaseline,
  type ProductionAuditPlan,
  type ProductionListingBaseline,
  type ProductionSourceListing,
} from "@/scripts/dealer-pack-audit-sync/production-types";
import {
  renderPreviewAuditReport,
  renderProductionAuditReport,
} from "@/scripts/dealer-pack-audit-sync/report";
import {
  PREVIEW_CONFIRM_DB,
  PRODUCTION_APPLY_CONFIRM_PHRASE,
  assertProductionApplySafety,
} from "@/scripts/dealer-pack-audit-sync/safety";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
  type PackBaseline,
  type PreviewPackAuditPlan,
  type ReplacePackAction,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import { vehicle } from "./dealer-stock-sync/fixtures";
import type { ArchivedVehicle } from "@/scripts/dealer-stock-sync/types";

const founding = PRODUCTION_ACCOUNTS[0]!;

function rejectedVehicle(): ArchivedVehicle {
  const raw = vehicle({ dealerKey: "athol-garage", sourceKey: "stock" });
  return {
    identityKey: "sourceVehicleId:stock-1",
    identityKind: "sourceVehicleId",
    sources: ["stock"],
    preferredSource: "stock",
    vehicle: raw,
    priceMismatch: false,
    identityConflict: false,
    conflictReason: null,
    contentHash: "hash",
    importable: true,
    importSkipReason: null,
    images: [{
      originalUrl: raw.imageUrls[0]!,
      localPath: null,
      contentType: "image/jpeg",
      bytes: 100,
      checksum: "shared",
      status: "skipped",
      error: "duplicate image content shared across listings",
    }],
  };
}

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

function replacementAction(
  overrides: Partial<ReplacePackAction> = {},
): ReplacePackAction {
  return {
    kind: "replace",
    dealerKey: "athol-garage",
    displayName: "Athol Garage",
    sourceRunId: "source-run",
    baseline: baseline(),
    listings: [{
      identityKey: "stock-1",
      sourceUrl: "https://dealer.example/stock-1",
      listing: {
        title: "2024 Example Car",
        description: "A sufficiently detailed vehicle description.",
        pricePence: 1_000_000,
        categorySlug: "car",
        attributes: { make: "Example", mileage: "1000" },
        imageUrls: ["https://stock.example/car.jpg"],
      },
      images: [{
        sourceUrl: "https://stock.example/car.jpg",
        localPath: "archive/car.jpg",
        checksum: "checksum-1",
        width: 1200,
        height: 800,
        format: "jpg",
        bytes: 100_000,
        order: 0,
      }],
      findings: [],
    }],
    excludedListings: [{
      identityKey: "stock-empty",
      sourceUrl: "https://dealer.example/stock-empty",
      title: "Broken Photo Car",
      reasons: [NO_VALID_SOURCE_IMAGE_REASON],
      findings: ["image-rejected:0:unusable-or-duplicate", NO_VALID_SOURCE_IMAGE_REASON],
    }],
    ...overrides,
  };
}

function previewPlan(): PreviewPackAuditPlan {
  return sealPlan({
    version: DEALER_PACK_AUDIT_VERSION,
    runId: "run-1",
    createdAt: "2026-09-28T21:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: REQUIRED_BACKUP_ID,
    sourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    actionCount: 1,
    actions: [replacementAction()],
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

function listing(
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

function accountBaseline(rows = [listing()]): ProductionAccountBaseline {
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

function source(overrides: Partial<ProductionSourceListing> = {}): ProductionSourceListing {
  return {
    identityKey: "source-1",
    managedKey: listing().slug!,
    sourceUrl: "https://dealer.example/stock/source-1",
    slug: listing().slug,
    listing: {
      title: "2024 Example Car",
      description: "A complete example dealer vehicle description.",
      pricePence: 1_000_000,
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

function productionPlan(
  overrides: Partial<Omit<ProductionAuditPlan, "fingerprint">> = {},
): Omit<ProductionAuditPlan, "fingerprint"> {
  return {
    version: PRODUCTION_AUDIT_VERSION,
    runId: "run-1",
    createdAt: "2026-09-28T21:00:00.000Z",
    target: {
      projectRef: PRODUCTION_PROJECT_REF,
      confirmDb: PRODUCTION_CONFIRM_DB,
    },
    backupId: PRODUCTION_BACKUP_ID,
    foundingSourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    finalPreviewRunId: "run-final",
    finalPreviewFingerprint: "final-preview-fingerprint",
    actionCount: 0,
    accounts: PRODUCTION_ACCOUNTS.map((account) => ({
      dealerKey: account.dealerKey,
      displayName: account.displayName,
      email: account.email,
      sourceKind: account.sourceKind,
      sourceRunId: "source-run",
      sourceChecksum: "checksum",
      applicable: true,
      blockers: [],
      baseline: accountBaseline([]),
      actions: [],
      excludedListings: [],
    })),
    ...overrides,
  };
}

describe("dealer pack audit image-defect hardening", () => {
  it("keeps zero-image vehicles out of includable listings with durable exclusion evidence", () => {
    const result = classifySnapshot({
      manifest: {
        dealerKey: "athol-garage",
        displayName: "Athol Garage",
        canArchive: true,
        scrapeFinishedAt: new Date().toISOString(),
        sources: [{ key: "stock", status: "ok" }],
      },
      vehicles: [rejectedVehicle()],
    });

    expect(result.safe).toBe(true);
    expect(result.reasons).not.toContain("no-includable-listings");
    expect(result.listings).toEqual([]);
    expect(result.excludedListings).toEqual([
      expect.objectContaining({
        identityKey: "sourceVehicleId:stock-1",
        title: "2022 Ford Focus ST-Line",
        reasons: [NO_VALID_SOURCE_IMAGE_REASON],
      }),
    ]);
  });

  it("omits unfixable preview listings from replace apply and retains them in the report", () => {
    const action = replacementAction({ listings: [] });
    expect(() => assertReplaceListingsHaveImages(action)).not.toThrow();
    expect(() =>
      assertReplaceListingsHaveImages(replacementAction({
        listings: [{
          ...replacementAction().listings[0]!,
          images: [],
        }],
      })),
    ).toThrow("no valid source image");

    const emptyImagePlan = structuredClone(previewPlan());
    emptyImagePlan.actions[0] = replacementAction({
      listings: [{ ...replacementAction().listings[0]!, images: [] }],
    });
    expect(() => assertPlanIntegrity(emptyImagePlan)).toThrow("no valid source image");

    const report = renderPreviewAuditReport({
      plan: previewPlan(),
      apply: null,
      verify: {
        runId: "run-1",
        planFingerprint: previewPlan().fingerprint,
        createdAt: "2026-09-28T21:05:00.000Z",
        ok: true,
        results: [{
          dealerKey: "athol-garage",
          ok: true,
          errors: [],
          listingCount: 1,
          imageCount: 1,
        }],
      },
    });
    expect(report).toContain("Excluded listings: 1");
    expect(report).toContain("Broken Photo Car");
    expect(report).toContain(NO_VALID_SOURCE_IMAGE_REASON);
    expect(report).not.toContain("allowEmptyImages");
  });
});

describe("production account hardening", () => {
  it("limits production config to Athol, Mike's, TD, and Ocean and excludes Rex", () => {
    expect(PRODUCTION_ACCOUNTS.map((account) => account.dealerKey)).toEqual([
      "athol-garage",
      "mikes-motors",
      "td-car-centre",
      "ocean-motor-village",
    ]);
    expect(isTemporaryExcludedProductionAccount(TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY))
      .toBe(true);
    expect(PRODUCTION_ACCOUNTS.map((account) => account.dealerKey)).not.toContain(
      TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
    );
  });

  it("takes down image-defect source listings and does not reactivate taken-down ones", () => {
    const defect = source({
      images: [],
      findings: [NO_VALID_SOURCE_IMAGE_REASON],
    });
    const partitioned = partitionProductionSourceListings([defect]);
    expect(partitioned.included).toEqual([]);
    expect(partitioned.excluded).toEqual([productionExcludedFromSource(defect)]);

    const live = planManagedNamespace({
      account: founding,
      baseline: accountBaseline([listing()]),
      source: partitioned.included,
    });
    expect(live.blockers).toEqual([]);
    expect(live.actions).toEqual([
      expect.objectContaining({
        kind: "take_down",
        listingId: "listing-1",
        fromStatus: "LIVE",
      }),
    ]);

    const alreadyDown = planManagedNamespace({
      account: founding,
      baseline: accountBaseline([listing({ status: "TAKEN_DOWN" })]),
      source: partitioned.included,
    });
    expect(alreadyDown.blockers).toEqual([]);
    expect(alreadyDown.actions).toEqual([]);
  });

  it("refuses Rex and empty-image production plans without changing the confirm phrase", () => {
    expect(PRODUCTION_APPLY_CONFIRM_PHRASE).toContain("four production dealer accounts");

    const withRex = productionPlan({
      accounts: [{
        dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
        displayName: "Rex Motor Company",
        email: "rexmotorcompany@itrader.im.preview",
        sourceKind: "founding",
        sourceRunId: "source-run",
        sourceChecksum: "checksum",
        applicable: true,
        blockers: [],
        baseline: accountBaseline([]),
        actions: [],
        excludedListings: [],
      }],
    });
    expect(() =>
      assertProductionPlanIntegrity(sealProductionPlan(withRex)),
    ).toThrow("rex-motor-company is excluded");

    const emptyImage = productionPlan({
      actionCount: 1,
      accounts: [{
        ...productionPlan().accounts[0]!,
        actions: [{ kind: "create", identityKey: "source-1", source: source({ images: [] }) }],
      }],
    });
    expect(() =>
      assertProductionPlanIntegrity(sealProductionPlan(emptyImage)),
    ).toThrow("no valid source image");
    expect(() =>
      assertProductionActionHasImages({
        kind: "create",
        identityKey: "source-1",
        source: source({ images: [] }),
      }),
    ).toThrow("no valid source image");

    const sealed = sealProductionPlan(productionPlan());
    expect(() =>
      assertProductionApplySafety({
        argv: [
          "apply-production",
          "--allow=1",
          `--production-ref=${PRODUCTION_PROJECT_REF}`,
          `--confirm-db=${PRODUCTION_CONFIRM_DB}`,
          `--backup-id=${PRODUCTION_BACKUP_ID}`,
          `--plan-fingerprint=${sealed.fingerprint}`,
          "--plan-count=0",
          `--confirm=${PRODUCTION_APPLY_CONFIRM_PHRASE}`,
        ],
        plan: {
          ...sealed,
          accounts: [
            ...sealed.accounts,
            {
              ...sealed.accounts[0]!,
              dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
            },
          ],
        },
        databaseUrl: `postgresql://postgres@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
      }),
    ).toThrow("rex-motor-company is excluded");
  });

  it("keeps image-defect exclusions in the production report and after shared-byte removal", () => {
    const first = source();
    const second = structuredClone(first);
    second.identityKey = "source-2";
    second.managedKey = "managed-2";
    second.slug = "fd-athol-garage-22222222222222222222222222222222";
    removeDuplicateSourceImages([first, second]);
    const partitioned = partitionProductionSourceListings([first, second]);
    expect(partitioned.included).toEqual([]);
    expect(partitioned.excluded.map((item) => item.identityKey)).toEqual([
      "source-1",
      "source-2",
    ]);

    const plan = sealProductionPlan(productionPlan({
      accounts: [{
        ...productionPlan().accounts[0]!,
        excludedListings: partitioned.excluded,
      }],
    }));
    const report = renderProductionAuditReport({
      plan,
      apply: {
        runId: plan.runId,
        planFingerprint: plan.fingerprint,
        createdAt: "2026-09-28T21:05:00.000Z",
        actionsApplied: 0,
        listings: [],
      },
      verify: {
        runId: plan.runId,
        planFingerprint: plan.fingerprint,
        createdAt: "2026-09-28T21:05:00.000Z",
        ok: true,
        accounts: [{
          dealerKey: founding.dealerKey,
          ok: true,
          errors: [],
          liveManaged: 0,
          takenDownManaged: 1,
          unmanaged: 0,
          imageCount: 0,
        }],
      },
    });
    expect(report).toContain("Excluded listings: 2");
    expect(report).toContain(NO_VALID_SOURCE_IMAGE_REASON);
  });
});
