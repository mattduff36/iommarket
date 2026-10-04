import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { planDatabaseSync } from "@/lib/database-sync/planner";
import { SYNC_TABLES } from "@/lib/database-sync/types";
import type { SyncDataset, SyncRow, SyncTable } from "@/lib/database-sync/types";

function dataset(overrides: Partial<Record<SyncTable, SyncRow[]>> = {}): SyncDataset {
  return Object.fromEntries(SYNC_TABLES.map((table) => [table, overrides[table] ?? []])) as SyncDataset;
}

const region = { id: "r1", name: "Isle of Man", slug: "isle-of-man", active: true, sortOrder: 1, createdAt: "2024-01-01T00:00:00.000Z" };
const category = { id: "c1", name: "Cars", slug: "cars", parentId: null, active: true, sortOrder: 1, createdAt: "2024-01-01T00:00:00.000Z" };
const user = { id: "u1", authUserId: "auth-prod-1", email: "private@example.com", name: "Person", phone: "secret", bio: "private", avatarUrl: "private-url", role: "ADMIN", regionId: "r1", disabledAt: null, disabledReason: null, disabledReasonCode: null, deletedAt: null, deletionReason: null, deletionRequestedAt: null, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };
const dealer = { id: "d1", userId: "u1", name: "Dealer", slug: "dealer", bio: null, website: null, phone: "dealer-phone", logoUrl: null, verified: true, tier: "PRO", isAdminPreview: false, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };
const listing = { id: "l1", userId: "u1", dealerId: "d1", categoryId: "c1", regionId: "r1", title: "Car", description: "Description", price: 100, status: "LIVE", featured: true, slug: "car", viewCount: 45, expiresAt: null, soldAt: null, trustDeclarationAccepted: true, trustDeclarationAcceptedAt: "2024-01-02T00:00:00.000Z", photoRevision: 4, lastPhotoMutationId: "mutation", lastPhotoMutationHash: "hash", lifecycleRevision: 7, retentionPurgedAt: null, previewPackId: null, reviewState: "NEEDS_REVIEW", reviewReasons: ["reason"], reviewSourceIdentity: "identity", reviewSourceUrl: "url", approvedAt: null, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };

describe("planDatabaseSync", () => {
  it("sanitizes new users and remaps lookup and owner references without importing auth or entitlements", () => {
    const source = dataset({
      Region: [region], Category: [category], User: [user], DealerProfile: [dealer], Listing: [listing],
      ListingImage: [{ id: "img1", listingId: "l1", url: "https://images.example/car.jpg", publicId: "public-1", order: 0, provider: "EXTERNAL", uploadIntentId: "intent-1" }],
    });
    const plan = planDatabaseSync({ mode: "merge", source, destination: dataset() });
    expect(plan.blockers).toEqual([]);
    const insertedUser = plan.operations.find((op) => op.action === "insert" && op.table === "User")!.after!;
    expect(insertedUser).toMatchObject({
      id: "u1", authUserId: "database-sync:u1", email: "sync-7531@example.invalid",
      name: null, phone: null, bio: null, avatarUrl: null, role: "DEALER", disabledAt: null,
    });
    const insertedDealer = plan.operations.find((op) => op.action === "insert" && op.table === "DealerProfile")!.after!;
    expect(insertedDealer).toMatchObject({ userId: "u1", verified: true, tier: "STARTER", isAdminPreview: false });
    const insertedListing = plan.operations.find((op) => op.action === "insert" && op.table === "Listing")!.after!;
    expect(insertedListing).toMatchObject({ status: "LIVE", featured: false, viewCount: 0, trustDeclarationAccepted: false, lifecycleRevision: 0, previewPackId: null, reviewState: "NONE" });
    const insertedImage = plan.operations.find((op) => op.action === "insert" && op.table === "ListingImage")!.after!;
    expect(insertedImage).toMatchObject({ listingId: "l1", uploadIntentId: null });
    expect(JSON.stringify(plan)).not.toContain("private@example.com");
    expect(JSON.stringify(plan)).not.toContain("secret");
  });

  it("excludes dealer and listing graphs owned by disabled or deleted production users", () => {
    const source = dataset({
      Region: [region], Category: [category],
      User: [{ ...user, id: "inactive-owner", role: "USER", disabledAt: "2025-01-01T00:00:00.000Z", deletedAt: null }],
      DealerProfile: [{ ...dealer, id: "inactive-dealer", userId: "inactive-owner" }],
      Listing: [{ ...listing, id: "inactive-listing", userId: "inactive-owner", dealerId: "inactive-dealer" }],
    });
    const plan = planDatabaseSync({ mode: "merge", source, destination: dataset() });
    expect(plan.operations.some((op) => op.action === "insert" && ["User", "DealerProfile", "Listing"].includes(op.table))).toBe(false);
  });

  it("maps reference rows by their natural keys and blocks an ID collision with a different identity", () => {
    const source = dataset({
      Region: [{ ...region, id: "prod-region" }],
      Category: [{ ...category, id: "prod-category" }],
      User: [{ ...user, id: "u-source", authUserId: "prod-auth", email: "source@example.test", role: "USER", regionId: "prod-region" }],
      Listing: [{ ...listing, userId: "u-source", dealerId: null, categoryId: "prod-category", regionId: "prod-region" }],
    });
    const destination = dataset({
      Region: [{ ...region, id: "dev-region" }],
      Category: [{ ...category, id: "dev-category" }],
    });
    const merged = planDatabaseSync({ mode: "merge", source, destination });
    expect(merged.operations.some((op) => op.table === "Region" || op.table === "Category")).toBe(false);
    expect(merged.operations.find((op) => op.table === "Listing")?.after).toMatchObject({ categoryId: "dev-category", regionId: "dev-region" });

    const collision = planDatabaseSync({
      mode: "merge",
      source: dataset({ Region: [{ ...region, slug: "other" }] }),
      destination: dataset({ Region: [region] }),
    });
    expect(collision.blockers).toContain("Region primary key conflicts with a different natural identity.");
    expect(collision.operations.some((op) => op.action === "skip" && op.table === "Region")).toBe(true);
  });

  it("keeps destination-only rows in Merge and proposes dependency-ordered deletes in Replace", () => {
    const source = dataset({ Region: [region], Category: [category] });
    const destination = dataset({
      Region: [{ ...region, id: "dev-region", slug: "dev-region" }],
      Category: [{ ...category, id: "dev-category", slug: "dev-category" }],
      ContentPage: [{ id: "page1", slug: "dev-page", title: "Dev", markdown: "Only in dev", status: "PUBLISHED" }],
    });
    const merge = planDatabaseSync({ mode: "merge", source, destination });
    expect(merge.operations.some((op) => op.action === "delete")).toBe(false);
    const replace = planDatabaseSync({ mode: "replace", source, destination });
    expect(replace.operations.filter((op) => op.action === "delete").map((op) => op.table)).toEqual(["ContentPage", "Category", "Region"].filter((table) => table === "ContentPage"));
    expect(replace.operations.some((op) => op.action === "delete" && op.table === "ContentPage" && op.key === "page1")).toBe(true);
    expect(replace.operations.some((op) => op.action === "delete" && op.table === "Region")).toBe(false);
    expect(replace.operations.some((op) => op.action === "delete" && op.table === "Category")).toBe(false);
    expect(replace.operations.some((op) => op.action === "preserve" && op.table === "Region" && op.key === "dev-region")).toBe(true);
  });

  it("imports a genuine listing linked to a preview pack after clearing only the pack reference", () => {
    const source = dataset({
      Region: [region], Category: [category],
      User: [{ ...user, role: "USER", phone: "never-export-this" }],
      Listing: [{ ...listing, dealerId: null, previewPackId: "historic-pack" }],
    });
    const plan = planDatabaseSync({ mode: "merge", source, destination: dataset() });
    expect(plan.blockers).toEqual([]);
    expect(plan.operations.find((op) => op.action === "insert" && op.table === "Listing")?.after)
      .toMatchObject({ status: "LIVE", previewPackId: null });
    expect(JSON.stringify(plan)).not.toContain("never-export-this");
  });

  it("retains production-linked child records owned by a protected development administrator", () => {
    const source = dataset({
      Region: [region], Category: [category],
      User: [{ ...user, role: "USER" }],
      DealerProfile: [dealer],
      Listing: [listing],
    });
    const destination = dataset({
      User: [{ ...user, role: "ADMIN", email: "dev-admin@example.invalid" }],
      DealerProfile: [{ ...dealer, name: "Development admin profile" }],
      Listing: [{ ...listing, title: "Development admin listing" }],
    });
    const plan = planDatabaseSync({ mode: "replace", source, destination });
    expect(plan.operations.some((op) => op.action === "update" && op.table === "DealerProfile")).toBe(false);
    expect(plan.operations.some((op) => op.action === "update" && op.table === "Listing")).toBe(false);
    expect(plan.operations.some((op) => op.action === "preserve" && op.table === "User" && op.key === "u1")).toBe(true);
    expect(plan.operations.some((op) => op.action === "preserve" && op.table === "DealerProfile" && op.key === "d1")).toBe(true);
    expect(plan.operations.some((op) => op.action === "preserve" && op.table === "Listing" && op.key === "l1")).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("dev-admin@example.invalid");
  });

  it("writes parent categories before children regardless of source row order", () => {
    const plan = planDatabaseSync({
      mode: "merge",
      source: dataset({ Category: [
        { ...category, id: "child", slug: "child", parentId: "root" },
        { ...category, id: "root", slug: "root", parentId: null },
      ] }),
      destination: dataset(),
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.operations.filter((op) => op.table === "Category").map((op) => op.key)).toEqual(["root", "child"]);
  });

  it("allows an exact proven Cloudinary-to-external image transition on the same unprotected row", () => {
    const originalPublicId = "iommarket/listings/prod-image";
    const digest = createHash("sha256").update(`CLOUDINARY\u0000${originalPublicId}`).digest("hex");
    const sourceImage = {
      id: "img1", listingId: "l1", url: "https://images.example/signed", publicId: `database-sync/${digest}`,
      provider: "EXTERNAL", assetId: null, uploadIntentId: null, order: 0,
    };
    const plan = planDatabaseSync({
      mode: "merge",
      source: dataset({ Region: [region], Category: [category], User: [{ ...user, role: "USER" }],
        Listing: [{ ...listing, dealerId: null }], ListingImage: [sourceImage] }),
      destination: dataset({ Region: [region], Category: [category], User: [{ ...user, role: "USER" }],
        Listing: [{ ...listing, dealerId: null }],
        ListingImage: [{ ...sourceImage, provider: "CLOUDINARY", publicId: originalPublicId, assetId: "asset1", url: "https://cloudinary.example/original" }],
      }),
      sourceImageOrigins: { img1: { provider: "CLOUDINARY", publicId: originalPublicId } },
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.operations.find((op) => op.table === "ListingImage" && op.action === "update")?.after)
      .toMatchObject({ provider: "EXTERNAL", publicId: `database-sync/${digest}`, assetId: null, uploadIntentId: null });
  });

  it("blocks an image identity transition without a matching original provider identity", () => {
    const digest = createHash("sha256").update("CLOUDINARY\u0000expected-original").digest("hex");
    const sourceImage = { id: "img1", listingId: "l1", url: "https://images.example/signed", publicId: `database-sync/${digest}`, provider: "EXTERNAL", assetId: null, uploadIntentId: null, order: 0 };
    const plan = planDatabaseSync({
      mode: "merge",
      source: dataset({ Region: [region], Category: [category], User: [{ ...user, role: "USER" }], Listing: [{ ...listing, dealerId: null }], ListingImage: [sourceImage] }),
      destination: dataset({ Region: [region], Category: [category], User: [{ ...user, role: "USER" }], Listing: [{ ...listing, dealerId: null }],
        ListingImage: [{ ...sourceImage, provider: "CLOUDINARY", publicId: "different-original", assetId: "asset1" }] }),
      sourceImageOrigins: { img1: { provider: "CLOUDINARY", publicId: "expected-original" } },
    });
    expect(plan.blockers).toContain("ListingImage primary key conflicts with a different natural identity.");
    expect(plan.operations.some((op) => op.action === "update" && op.table === "ListingImage")).toBe(false);
  });

  it("preserves development admins, preview packs, admin-preview/sample listings, and their images", () => {
    const destination = dataset({
      User: [{ ...user, role: "ADMIN", email: "admin@dev.example" }],
      DealerProfile: [{ ...dealer, isAdminPreview: true }],
      Listing: [
        { ...listing, id: "preview", status: "ADMIN_PREVIEW" },
        { ...listing, id: "sample", status: "LIVE" },
        { ...listing, id: "pack", previewPackId: "pack1" },
      ],
      ListingImage: [{ id: "img", listingId: "preview", url: "https://example.test/i.png", publicId: "p", order: 0 }],
    });
    const plan = planDatabaseSync({
      mode: "replace", source: dataset(), destination,
      protected: { previewPackDealerProfileIds: ["d1"], sampleCheckoutTargetIds: ["sample"] },
    });
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "User")).toBe(false);
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "DealerProfile")).toBe(false);
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "Listing")).toBe(false);
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "ListingImage")).toBe(false);
    expect(plan.counts.User.preserve).toBeGreaterThan(0);
    expect(plan.counts.DealerProfile.preserve).toBeGreaterThan(0);
    expect(plan.counts.Listing.preserve).toBeGreaterThanOrEqual(3);
  });

  it("blocks Replace deletion when excluded child rows still reference a marketplace row", () => {
    const plan = planDatabaseSync({
      mode: "replace",
      source: dataset(),
      destination: dataset({ ContentPage: [{ id: "page1", slug: "old", title: "Old", markdown: "x", status: "DRAFT" }] }),
      blockedDeletes: [{ table: "ContentPage", id: "page1", references: ["EditorialReference"] }],
    });
    expect(plan.blockers).toContain("Cannot replace ContentPage page1; referenced by excluded data: EditorialReference.");
    expect(plan.operations.some((op) => op.action === "skip" && op.key === "page1")).toBe(true);
    expect(plan.operations.some((op) => op.action === "delete" && op.key === "page1")).toBe(false);
  });

  it("archives blocked listing and dealer history while preserving listing children", () => {
    const oldListing = { ...listing, title: "Development history", status: "SOLD", soldAt: "2024-02-01T00:00:00.000Z" };
    const oldDealer = { ...dealer, name: "Development dealer history", tier: "PRO" };
    const image = { id: "old-image", listingId: "l1", url: "https://example.test/old.jpg", publicId: "old", order: 0 };
    const attribute = { id: "old-attribute", listingId: "l1", attributeDefinitionId: "a1", value: "kept" };
    const destination = dataset({
      Listing: [oldListing], DealerProfile: [oldDealer], ListingImage: [image], ListingAttributeValue: [attribute],
    });
    const base = { mode: "replace" as const, source: dataset(), destination,
      blockedDeletes: [
        { table: "Listing" as const, id: "l1", references: ["Payment", "ListingStatusEvent"] },
        { table: "DealerProfile" as const, id: "d1", references: ["Subscription", "DealerReview"] },
      ] };
    const blocked = planDatabaseSync(base);
    expect(blocked.blockers).toHaveLength(2);

    const plan = planDatabaseSync({ ...base, archiveBlockedDeletes: true });
    expect(plan.blockers).toEqual([]);
    expect(plan.archivedListingIds).toEqual(["l1"]);
    expect(plan.archivedDealerProfileIds).toEqual(["d1"]);
    expect(plan.operations.find((op) => op.archive && op.table === "Listing"))
      .toMatchObject({ action: "update", key: "l1", after: { status: "TAKEN_DOWN", title: "Development history", soldAt: oldListing.soldAt } });
    expect(plan.operations.find((op) => op.archive && op.table === "DealerProfile"))
      .toMatchObject({ action: "preserve", key: "d1", before: oldDealer });
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "ListingImage" && op.key === "old-image")).toBe(false);
    expect(plan.operations.some((op) => op.action === "delete" && op.table === "ListingAttributeValue" && op.key === "old-attribute")).toBe(false);
    expect(plan.operations.some((op) => op.action === "preserve" && op.table === "ListingImage" && op.key === "old-image")).toBe(true);
    expect(plan.operations.some((op) => op.action === "preserve" && op.table === "ListingAttributeValue" && op.key === "old-attribute")).toBe(true);
  });

  it("returns stable data-only fingerprints and does not include non-manifest columns", () => {
    const source = dataset({ Region: [{ ...region, secretColumn: "do not copy" }] });
    const first = planDatabaseSync({ mode: "merge", source, destination: dataset() });
    const second = planDatabaseSync({ mode: "merge", source, destination: dataset() });
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.operations[0].after).not.toHaveProperty("secretColumn");
    expect(JSON.stringify(first)).not.toContain("do not copy");
    const privateChanged = dataset({ Region: [region], User: [{ ...user, email: "changed-private@example.test", phone: "changed" }] });
    const privateOriginal = dataset({ Region: [region], User: [{ ...user, email: "private@example.com", phone: "secret" }] });
    expect(planDatabaseSync({ mode: "merge", source: privateChanged, destination: dataset() }).sourceHash)
      .toBe(planDatabaseSync({ mode: "merge", source: privateOriginal, destination: dataset() }).sourceHash);
  });
});
