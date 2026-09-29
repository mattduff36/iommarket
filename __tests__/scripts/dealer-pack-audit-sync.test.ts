import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertBaselineMatches } from "@/scripts/dealer-pack-audit-sync/baseline";
import { assertPackListingOwnership } from "@/scripts/dealer-pack-audit-sync/apply";
import { classifySnapshot } from "@/scripts/dealer-pack-audit-sync/classify";
import { verifyExactPackState } from "@/scripts/dealer-pack-audit-sync/exact";
import {
  assertPlanIntegrity,
  sealPlan,
} from "@/scripts/dealer-pack-audit-sync/plan-file";
import {
  APPLY_CONFIRM_PHRASE,
  assertApplySafety,
  PREVIEW_CONFIRM_DB,
  verifyRequiredBackup,
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function baseline(): PackBaseline {
  return {
    packId: "pack-1",
    dealerProfileId: "dealer-1",
    sourceRunId: "old-run",
    enabled: true,
    updatedAt: "2026-09-28T20:00:00.000Z",
    listings: [{
      id: "listing-old",
      userId: "user-1",
      dealerId: "dealer-1",
      previewPackId: "pack-1",
      status: "ADMIN_PREVIEW",
      lifecycleRevision: 2,
      photoRevision: 3,
      updatedAt: "2026-09-28T20:00:00.000Z",
      images: [{
        id: "image-old",
        publicId: "iommarket/listings/preview-packs/x/0",
        order: 0,
        provider: "CLOUDINARY",
      }],
      revisions: [],
    }],
  };
}

function unsignedPlan(): Omit<PreviewPackAuditPlan, "fingerprint"> {
  return {
    version: DEALER_PACK_AUDIT_VERSION,
    runId: "run-1",
    createdAt: "2026-09-28T21:00:00.000Z",
    target: { projectRef: PREVIEW_PROJECT_REF, confirmDb: PREVIEW_CONFIRM_DB },
    backupId: REQUIRED_BACKUP_ID,
    sourceRunId: "source-run-reviewed",
    adminUserId: "admin-1",
    actionCount: 1,
    actions: [{
      kind: "disable" as const,
      dealerKey: "dealer-a",
      displayName: "Dealer A",
      sourceRunId: null,
      baseline: baseline(),
      removeListings: true,
      reasons: ["unsafe"],
    }],
  };
}

describe("dealer pack audit frozen plans", () => {
  it("rejects a plan changed after fingerprinting", () => {
    const plan = sealPlan(unsignedPlan());
    plan.actions[0]!.displayName = "Tampered";
    expect(() => assertPlanIntegrity(plan)).toThrow("fingerprint");
  });

  it("rejects wrong targets and backup confirmations", () => {
    const plan = sealPlan(unsignedPlan());
    const common = [
      "apply-preview",
      "--allow=1",
      `--preview-ref=${PREVIEW_PROJECT_REF}`,
      `--confirm-db=${PREVIEW_CONFIRM_DB}`,
      `--plan-fingerprint=${plan.fingerprint}`,
      "--plan-count=1",
      `--confirm=${APPLY_CONFIRM_PHRASE}`,
    ];
    expect(() => assertApplySafety({
      argv: [...common, "--backup-id=wrong"],
      plan,
      databaseUrl: `postgresql://postgres@db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`,
    })).toThrow("backup ID");
    expect(() => assertApplySafety({
      argv: [
        ...common.filter((arg) => !arg.startsWith("--confirm-db=")),
        "--confirm-db=db.production.invalid/postgres",
        `--backup-id=${REQUIRED_BACKUP_ID}`,
      ],
      plan,
      databaseUrl: `postgresql://postgres@db.${PREVIEW_PROJECT_REF}.supabase.co/postgres`,
    })).toThrow("confirmation mismatch");
  });

  it("requires a correctly targeted backup manifest with valid hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pack-audit-"));
    temporaryDirectories.push(root);
    const dir = join(root, ".local", "db-backups", REQUIRED_BACKUP_ID);
    await mkdir(dir, { recursive: true });
    const payloads = {
      "waitlist.json": Buffer.from("{}"),
      "counts.json": Buffer.from("{}"),
      "auth-instance.json": Buffer.from("{}"),
      "truncate.sql": Buffer.from("BEGIN; COMMIT;"),
      "public-auth.data.sql": Buffer.alloc(1_000_001, 65),
    };
    await Promise.all(
      Object.entries(payloads).map(([name, bytes]) => writeFile(join(dir, name), bytes)),
    );
    const files = Object.entries(payloads).map(([name, bytes]) => ({
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    }));
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      id: REQUIRED_BACKUP_ID,
      workstream: "prod-mirror-20260831",
      targetRef: "wrong-ref",
      confirmDb: PREVIEW_CONFIRM_DB,
      files,
    }));
    expect(() => verifyRequiredBackup(root)).toThrow("target mismatch");
    await writeFile(join(dir, "manifest.json"), JSON.stringify({
      id: REQUIRED_BACKUP_ID,
      workstream: "prod-mirror-20260831",
      targetRef: PREVIEW_PROJECT_REF,
      confirmDb: PREVIEW_CONFIRM_DB,
      files: files.map((file, index) =>
        index === 0 ? { ...file, sha256: "0".repeat(64) } : file),
    }));
    expect(() => verifyRequiredBackup(root)).toThrow("hash mismatch");
  });
});

describe("dealer pack audit classification and CAS", () => {
  it("classifies incomplete source status as unsafe", () => {
    const result = classifySnapshot({
      manifest: {
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        canArchive: true,
        sources: [{ key: "stock", status: "failed" }],
      },
      vehicles: [],
    });
    expect(result.safe).toBe(false);
    expect(result.reasons).toContain("source-status-incomplete");
  });

  it("rejects a silently empty required source that reports ok", () => {
    const result = classifySnapshot({
      manifest: {
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        canArchive: true,
        scrapeFinishedAt: new Date().toISOString(),
        sources: [{ key: "stock", required: true, status: "ok" }],
      },
      vehicles: [],
    });
    expect(result.safe).toBe(false);
    expect(result.noPublicStock).toBe(false);
    expect(result.reasons).toContain("no-includable-listings");
  });

  it("accepts empty inventory only when required sources explicitly say so", () => {
    const result = classifySnapshot({
      manifest: {
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        canArchive: true,
        scrapeFinishedAt: new Date().toISOString(),
        sources: [{ key: "stock", required: true, status: "no_public_stock" }],
      },
      vehicles: [],
    });
    expect(result.noPublicStock).toBe(true);
    expect(result.reasons).toEqual(["no-public-stock"]);
  });

  it("detects ordered image changes in the full baseline CAS", () => {
    const current = structuredClone(baseline());
    current.listings[0]!.images[0]!.id = "changed-image";
    expect(() => assertBaselineMatches(baseline(), current)).toThrow("baseline changed");
  });

  it("retains an html-structured source listing when every image is rejected", () => {
    const raw = vehicle({ dealerKey: "dealer-a", sourceKey: "stock" });
    const archived: ArchivedVehicle = {
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
    const result = classifySnapshot({
      manifest: {
        dealerKey: "dealer-a",
        displayName: "Dealer A",
        connectorKey: "html-structured",
        canArchive: true,
        scrapeFinishedAt: new Date().toISOString(),
        sources: [{ key: "stock", status: "ok" }],
      },
      vehicles: [archived],
    });
    expect(result.safe).toBe(true);
    expect(result.listings[0]?.images).toEqual([]);
    expect(result.listings[0]?.findings).toContain(
      "listing-has-no-valid-source-image",
    );
  });

  it("refuses deletion when a pack listing is cross-owned", () => {
    const action = sealPlan(unsignedPlan()).actions[0]!;
    action.baseline.listings[0]!.userId = "other-user";
    expect(() =>
      assertPackListingOwnership(action, {
        userId: "user-1",
        dealerId: "dealer-1",
      }),
    ).toThrow("ownership mismatch");
  });
});

function replacementAction(): ReplacePackAction {
  return {
    kind: "replace",
    dealerKey: "dealer-a",
    displayName: "Dealer A",
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
  };
}

describe("dealer pack exact replacement verification", () => {
  it("accepts exact identity, fields, and ordered image evidence", () => {
    const action = replacementAction();
    const errors = verifyExactPackState({
      action,
      applied: {
        dealerKey: action.dealerKey,
        action: "replace",
        status: "applied",
        listings: [{
          identityKey: "stock-1",
          listingId: "listing-1",
          sourceUrls: ["https://stock.example/car.jpg"],
          sourceChecksums: ["checksum-1"],
          publicIds: ["iommarket/listings/preview-packs/dealer-a/stock-1/run/0"],
          finalImages: [{
            publicId: "iommarket/listings/preview-packs/dealer-a/stock-1/run/0",
            width: 1200,
            height: 800,
            format: "jpg",
            bytes: 100_000,
          }],
        }],
      },
      live: {
        dealerProfileId: "dealer-1",
        sourceRunId: "source-run",
        enabled: true,
        listings: [{
          id: "listing-1",
          dealerId: "dealer-1",
          title: "2024 Example Car",
          description: "A sufficiently detailed vehicle description.",
          price: 1_000_000,
          status: "ADMIN_PREVIEW",
          category: { slug: "car" },
          attributeValues: [
            { value: "Example", attributeDefinition: { slug: "make" } },
            { value: "1000", attributeDefinition: { slug: "mileage" } },
          ],
          images: [{
            publicId: "iommarket/listings/preview-packs/dealer-a/stock-1/run/0",
            assetId: "asset-1",
            order: 0,
            width: 1200,
            height: 800,
            format: "jpg",
            bytes: 100_000,
          }],
        }],
      },
    });
    expect(errors).toEqual([]);
  });

  it("requires disabled packs to be empty when removal is planned", () => {
    const action = sealPlan(unsignedPlan()).actions[0]!;
    const liveListing = {} as never;
    expect(verifyExactPackState({
      action,
      live: {
        dealerProfileId: "dealer-1",
        sourceRunId: "old-run",
        enabled: true,
        listings: [liveListing],
      },
    })).toEqual(["pack-enabled", "disabled-pack-has-listings"]);
  });
});
