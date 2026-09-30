import { describe, expect, it } from "vitest";
import {
  FOUNDING_IMPORT_NOTES,
  classifyProductionListingProvenance,
  planManagedNamespace,
} from "@/scripts/dealer-pack-audit-sync/production-baseline";
import { applyProductionAuditPlan, productionCleanupPublicIds } from "@/scripts/dealer-pack-audit-sync/production-apply";
import { buildProductionAuditPlan } from "@/scripts/dealer-pack-audit-sync/production-plan";
import { verifyProductionAuditPlan } from "@/scripts/dealer-pack-audit-sync/production-verify";
import {
  DEALER_PACK_AUDIT_VERSION,
  REQUIRED_BACKUP_ID,
} from "@/scripts/dealer-pack-audit-sync/types";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";
import type { PrismaClient } from "@prisma/client";
import { removeDuplicateSourceImages } from "@/scripts/dealer-pack-audit-sync/production-source";
import {
  assertProductionPlanIntegrity,
  sealPlan,
  sealProductionPlan,
} from "@/scripts/dealer-pack-audit-sync/plan-file";
import {
  PREVIEW_CONFIRM_DB,
  PRODUCTION_APPLY_CONFIRM_PHRASE,
  assertProductionApplySafety,
  verifyProductionBackup,
} from "@/scripts/dealer-pack-audit-sync/safety";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_AUDIT_VERSION,
  PRODUCTION_BACKUP_ID,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  type ProductionAccountBaseline,
  type ProductionAuditPlan,
  type ProductionListingBaseline,
  type ProductionSourceListing,
} from "@/scripts/dealer-pack-audit-sync/production-types";

const founding = PRODUCTION_ACCOUNTS[0]!;
const ocean = PRODUCTION_ACCOUNTS.find((account) => account.dealerKey === "ocean-motor-village")!;

function event(
  fromStatus: string | null,
  toStatus: string,
  action: string,
  notes = FOUNDING_IMPORT_NOTES,
) {
  return {
    id: `${fromStatus}-${toStatus}`,
    fromStatus,
    toStatus,
    changedByUserId: "admin-1",
    source: "ADMIN",
    action,
    notes,
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

function baseline(rows = [listing()]): ProductionAccountBaseline {
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

describe("production dealer pack provenance", () => {
  it("requires deterministic founding slug, exact owner, and admin event evidence", () => {
    expect(classifyProductionListingProvenance({
      account: founding,
      baseline: baseline(),
      listing: listing(),
    })).toEqual({ kind: "managed", managedKey: listing().slug });

    const missingEvidence = listing({ statusEvents: [] });
    expect(classifyProductionListingProvenance({
      account: founding,
      baseline: baseline([missingEvidence]),
      listing: missingEvidence,
    })).toEqual({ kind: "ambiguous", reason: "founding-provenance:listing-1" });
  });

  it("never treats Ocean title/price/mileage alone as managed provenance", () => {
    const row = listing({
      slug: null,
      title: "Ocean Motor Village Vehicle",
      images: [],
      statusEvents: [],
    });
    const oceanBaseline = baseline([row]);
    oceanBaseline.user.email = ocean.email;
    oceanBaseline.dealer.name = ocean.displayName;
    expect(classifyProductionListingProvenance({
      account: ocean,
      baseline: oceanBaseline,
      listing: row,
    })).toEqual({ kind: "unmanaged" });

    row.images = [{
      ...listing().images[0]!,
      publicId: "iommarket/listings/import/user-1/stock-1/attempt/0",
    }];
    expect(classifyProductionListingProvenance({
      account: ocean,
      baseline: oceanBaseline,
      listing: row,
    }).kind).toBe("ambiguous");
  });

  it("keeps an image-less Ocean audit listing managed by deterministic slug", () => {
    const row = listing({
      slug: "omv-11111111111111111111111111111111",
      images: [],
      statusEvents: [
        event(null, "DRAFT", "SYSTEM_BACKFILL", "Ocean inventory import"),
        event("DRAFT", "PENDING", "SUBMIT", "Ocean inventory import"),
        event("PENDING", "LIVE", "APPROVE", "Ocean inventory import"),
      ],
    });
    const oceanBaseline = baseline([row]);
    oceanBaseline.user.email = ocean.email;
    oceanBaseline.dealer.name = ocean.displayName;
    expect(classifyProductionListingProvenance({
      account: ocean,
      baseline: oceanBaseline,
      listing: row,
    })).toEqual({ kind: "managed", managedKey: row.slug });
  });

  it("recognizes legacy Ocean repair images only when bound to the exact listing", () => {
    const row = listing({
      slug: null,
      images: [{
        ...listing().images[0]!,
        publicId: "iommarket/listings/repair/repair-run/listing-1/0",
      }],
      statusEvents: [
        event(null, "DRAFT", "SYSTEM_BACKFILL", "Ocean inventory import"),
        event("DRAFT", "PENDING", "SUBMIT", "Ocean inventory import"),
        event("PENDING", "LIVE", "APPROVE", "Ocean inventory import"),
      ],
    });
    const oceanBaseline = baseline([row]);
    oceanBaseline.user.email = ocean.email;
    oceanBaseline.dealer.name = ocean.displayName;
    expect(classifyProductionListingProvenance({
      account: ocean,
      baseline: oceanBaseline,
      listing: row,
    })).toEqual({ kind: "managed", managedKey: "legacy-ocean-listing-1" });

    row.images[0]!.publicId =
      "iommarket/listings/repair/repair-run/a-different-listing/0";
    expect(classifyProductionListingProvenance({
      account: ocean,
      baseline: oceanBaseline,
      listing: row,
    }).kind).toBe("ambiguous");
  });
});

describe("production managed namespace planning", () => {
  it("updates source-backed listings and takes stale managed listings down", () => {
    const stale = listing({
      id: "listing-stale",
      slug: `fd-athol-garage-${"b".repeat(32)}`,
    });
    const result = planManagedNamespace({
      account: founding,
      baseline: baseline([listing(), stale]),
      source: [source()],
    });
    expect(result.blockers).toEqual([]);
    expect(result.actions.map((action) => action.kind)).toEqual([
      "update",
      "take_down",
    ]);
    expect(result.actions[1]).toMatchObject({
      listingId: "listing-stale",
      fromStatus: "LIVE",
    });
  });

  it("refuses ambiguous candidate provenance", () => {
    const ambiguous = listing({ statusEvents: [] });
    const result = planManagedNamespace({
      account: founding,
      baseline: baseline([ambiguous]),
      source: [source()],
    });
    expect(result.blockers).toContain("founding-provenance:listing-1");
  });
});

describe("production frozen plan and cleanup safety", () => {
  function plan(): Omit<ProductionAuditPlan, "fingerprint"> {
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
        baseline: baseline([]),
        actions: [],
        excludedListings: [],
      })),
    };
  }

  it("rejects mutation after a production plan is sealed", () => {
    const sealed = sealProductionPlan(plan());
    sealed.accounts[0]!.displayName = "Tampered";
    expect(() => assertProductionPlanIntegrity(sealed)).toThrow("fingerprint");
  });

  it("accepts a sealed non-empty subset of the production allowlist", () => {
    const scoped = plan();
    scoped.accounts = [scoped.accounts[1]!];
    expect(() =>
      assertProductionPlanIntegrity(sealProductionPlan(scoped)),
    ).not.toThrow();
  });

  it("queues cleanup only for import, repair, and founding-owned assets", () => {
    expect(productionCleanupPublicIds([
      { provider: "CLOUDINARY", publicId: "iommarket/listings/import/u/k/a/0" },
      { provider: "CLOUDINARY", publicId: "iommarket/listings/repair/run/k/0" },
      { provider: "CLOUDINARY", publicId: "iommarket/listings/founding/d/k/0" },
      { provider: "CLOUDINARY", publicId: "iommarket/listings/staging/user-owned" },
      { provider: "EXTERNAL", publicId: "iommarket/listings/import/external" },
    ])).toEqual([
      "iommarket/listings/import/u/k/a/0",
      "iommarket/listings/repair/run/k/0",
      "iommarket/listings/founding/d/k/0",
    ]);
  });

  it("freezes a non-legacy backup ID and binds apply safety to that exact ID", () => {
    const unsigned = plan();
    unsigned.backupId = "pmr-2026-09-29T21-00-00-000Z-production";
    const sealed = sealProductionPlan(unsigned);
    const url = `postgresql://postgres@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`;
    const argv = [
      "apply-production",
      "--allow=1",
      `--production-ref=${PRODUCTION_PROJECT_REF}`,
      `--confirm-db=${PRODUCTION_CONFIRM_DB}`,
      `--plan-fingerprint=${sealed.fingerprint}`,
      "--plan-count=0",
      `--confirm=${PRODUCTION_APPLY_CONFIRM_PHRASE}`,
    ];
    expect(() => assertProductionApplySafety({
      argv: [...argv, `--backup-id=${sealed.backupId}`],
      plan: sealed,
      databaseUrl: url,
    })).not.toThrow();
    expect(() => assertProductionApplySafety({
      argv: [...argv, `--backup-id=${PRODUCTION_BACKUP_ID}`],
      plan: sealed,
      databaseUrl: url,
    })).toThrow("does not match the frozen plan");
    expect(() => assertProductionApplySafety({
      argv,
      plan: sealed,
      databaseUrl: url,
    })).toThrow("--backup-id is required");
    expect(() =>
      assertProductionPlanIntegrity(sealProductionPlan({ ...plan(), backupId: "" })),
    ).toThrow("backup ID is invalid");
    expect(() => verifyProductionBackup(process.cwd())).toThrow("--backup-id is required");
  });

  it("freezes finalized preview provenance and rejects candidate production inputs", async () => {
    const url = `postgresql://postgres@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`;
    expect(() =>
      assertProductionPlanIntegrity(sealProductionPlan({
        ...plan(),
        finalPreviewRunId: "",
      })),
    ).toThrow("missing finalized preview provenance");
    const tampered = sealProductionPlan(plan());
    tampered.finalPreviewFingerprint = "tampered-preview-fingerprint";
    expect(() => assertProductionPlanIntegrity(tampered)).toThrow("fingerprint");
    const missingApplyProvenance = sealProductionPlan({
      ...plan(),
      finalPreviewFingerprint: "",
    });
    expect(() =>
      assertProductionApplySafety({
        argv: [
          "apply-production",
          "--allow=1",
          `--production-ref=${PRODUCTION_PROJECT_REF}`,
          `--confirm-db=${PRODUCTION_CONFIRM_DB}`,
          `--backup-id=${PRODUCTION_BACKUP_ID}`,
          `--plan-fingerprint=${missingApplyProvenance.fingerprint}`,
          "--plan-count=0",
          `--confirm=${PRODUCTION_APPLY_CONFIRM_PHRASE}`,
        ],
        plan: missingApplyProvenance,
        databaseUrl: url,
      }),
    ).toThrow("missing finalized preview provenance");

    const candidatePreview = sealPlan({
      version: DEALER_PACK_AUDIT_VERSION,
      runId: "run-candidate",
      createdAt: "2026-09-29T22:00:00.000Z",
      target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
      backupId: REQUIRED_BACKUP_ID,
      sourceRunId: "source-run",
      adminUserId: "admin-1",
      actionCount: 0,
      actions: [],
    });
    expect(candidatePreview.liveFinalization).toBeUndefined();
    await expect(buildProductionAuditPlan({
      prisma: {} as PrismaClient,
      runId: "run-1",
      foundingSourceRunId: "source-run",
      backupId: PRODUCTION_BACKUP_ID,
      finalPreviewPlan: candidatePreview,
    })).rejects.toThrow("preview plan is not live-finalized");
    const missingProvenance = sealProductionPlan({ ...plan(), finalPreviewRunId: "" });
    await expect(applyProductionAuditPlan({
      prisma: {} as PrismaClient,
      plan: missingProvenance,
    })).rejects.toThrow("missing finalized preview provenance");
    await expect(verifyProductionAuditPlan({
      prisma: {} as PrismaClient,
      plan: missingProvenance,
      applyReport: null,
    })).rejects.toThrow("missing finalized preview provenance");
  });

  it("requires an explicit backup ID before building a production plan", async () => {
    await expect(buildProductionAuditPlan({
      prisma: {} as PrismaClient,
      runId: "run-1",
      foundingSourceRunId: "source-run",
      backupId: "",
      finalPreviewPlan: sealPlan({
        version: DEALER_PACK_AUDIT_VERSION,
        runId: "run-final",
        createdAt: "2026-09-29T22:00:00.000Z",
        target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
        backupId: REQUIRED_BACKUP_ID,
        sourceRunId: "source-run",
        adminUserId: "admin-1",
        actionCount: 0,
        actions: [],
      }),
    })).rejects.toThrow("production-backup-id-required");
  });
});

describe("production source image deduplication", () => {
  it("drops unresolved shared chrome from every listing", () => {
    const first = source();
    const second = structuredClone(first);
    second.identityKey = "source-2";
    second.managedKey = "managed-2";
    second.slug = "fd-athol-garage-22222222222222222222222222222222";

    removeDuplicateSourceImages([first, second]);

    expect(first.images).toEqual([]);
    expect(second.images).toEqual([]);
    expect(first.findings).toContain("image-rejected:0:shared-across-listings");
    expect(second.findings).toContain("image-rejected:0:shared-across-listings");
    expect(first.findings).toContain("listing-has-no-valid-source-image");
    expect(second.findings).toContain("listing-has-no-valid-source-image");
  });

  it("keeps a unique provable owner and strips Ocean contaminants", () => {
    const ownerUrl = "https://cdn.example.com/vehicles/stock-1/hero.jpg";
    const owner = source({
      identityKey: "sourceVehicleId:stock-1",
      managedKey: "omv-owner-stock-1",
      sourceUrl: "https://www.oceanford.com/used-cars/stock-1/",
      slug: "omv-owner-stock-1",
      listing: {
        ...source().listing,
        imageUrls: [ownerUrl],
      },
      images: [{
        ...source().images[0]!,
        sourceUrl: ownerUrl,
        checksum: "shared-bytes",
      }],
    });
    const contaminant = source({
      identityKey: "sourceVehicleId:stock-2",
      managedKey: "omv-other-stock-2",
      sourceUrl: "https://www.oceanford.com/used-cars/stock-2/",
      slug: "omv-other-stock-2",
      listing: {
        ...source().listing,
        imageUrls: [ownerUrl],
      },
      images: [{
        ...source().images[0]!,
        sourceUrl: ownerUrl,
        checksum: "shared-bytes",
      }],
    });

    removeDuplicateSourceImages([contaminant, owner]);

    expect(owner.images).toHaveLength(1);
    expect(owner.images[0]?.sourceUrl).toBe(ownerUrl);
    expect(owner.findings).toContain("image-kept:0:owned");
    expect(owner.findings).not.toContain("listing-has-no-valid-source-image");
    expect(contaminant.images).toEqual([]);
    expect(contaminant.findings).toContain("image-rejected:0:owned-by:sourceVehicleId:stock-1");
    expect(contaminant.findings).toContain("listing-has-no-valid-source-image");
  });
});
