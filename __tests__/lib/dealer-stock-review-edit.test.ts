import { describe, expect, it } from "vitest";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import {
  canEditStockReviewAction,
  correctStockReviewActions,
  planAfterCorrection,
  stockReviewCorrectionSchema,
  stockReviewDraft,
} from "@/lib/dealer-stock-sync/review-edit";
import type { PlanAction, ReviewedActionEvidence } from "@/lib/dealer-stock-sync/types";

const review = (overrides: Partial<ReviewedActionEvidence> = {}): ReviewedActionEvidence => ({
  displayTitle: "2020 Ford Focus",
  flags: ["missing-description"],
  pricePence: null,
  mileage: 12000,
  year: null,
  categorySlug: "car",
  sourceUrl: "https://dealer.example/focus",
  safePhotoUrls: ["https://images.example/car.jpg"],
  availability: "available",
  provenance: ["reviewed-snapshot"],
  sourceHash: "a".repeat(64),
  capturedAt: "2026-10-21T00:00:00.000Z",
  coverageWarning: null,
  capacityWarning: null,
  fuel: null,
  transmission: null,
  ...overrides,
});

const blocked = (overrides: Partial<Extract<PlanAction, { kind: "blocked" }>> = {}): PlanAction => ({
  kind: "blocked",
  section: "new",
  reason: "review-flag",
  sourceIdentityKey: "sourceVehicleId:abc",
  listingId: null,
  displayTitle: "2020 Ford Focus",
  review: review(),
  ...overrides,
});

const correction = {
  reportId: "report-1",
  fingerprint: "a".repeat(64),
  sourceIdentityKey: "sourceVehicleId:abc",
  categorySlug: "car" as const,
  title: "Ford Focus",
  description: "A complete description of this available vehicle.",
  price: 1_250_000,
  attributes: { mileage: "1000", make: "Ford", model: "Focus" },
  photoUrls: ["https://images.example/car.jpg"],
  reason: "Admin corrected the missing description.",
  confirmAvailable: true as const,
};

const snapshot = (actions: PlanAction[]): FingerprintSnapshot => ({
  dealer: { id: "d", userId: "u", regionId: "r", tier: "STARTER", isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
  binding: { id: "b", registryKey: "franklins", enabled: true, verifiedAt: "2026-01-01T00:00:00.000Z" },
  activeListingCount: 0,
  listingCap: 30,
  listings: [],
  identities: [],
  actions,
});

describe("stock review correction helpers", () => {
  it("blocks sold, linked, identity, conflict and removal rows", () => {
    expect(canEditStockReviewAction(blocked())).toBe(true);
    for (const reason of ["source-conflict", "unmatched-archive", "ambiguous-archive"]) {
      expect(canEditStockReviewAction(blocked({ reason }))).toBe(true);
    }
    expect(canEditStockReviewAction(blocked({ reason: "sold-exclude-from-live-import" }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ reason: "duplicate-source", section: "other" }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ reason: "unstable-identity", sourceIdentityKey: null }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ reason: "unmapped-existing-stock" }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ listingId: "listing-1" }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ review: review({ availability: "sold" }) }))).toBe(false);
    expect(canEditStockReviewAction(blocked({ review: review({ flags: ["sold-exclude-from-live-import"] }) }))).toBe(false);
    expect(canEditStockReviewAction({ kind: "conflict", sourceIdentityKey: "sourceVehicleId:abc", listingId: "listing-1", reason: "dealer-edited", changes: [] })).toBe(false);
    expect(canEditStockReviewAction({ kind: "unpublish", sourceIdentityKey: "sourceVehicleId:abc", listingId: "listing-1", absenceCount: 2, lifecycleRevision: 1 })).toBe(false);
    expect(canEditStockReviewAction({
      kind: "create", sourceIdentityKey: "sourceVehicleId:abc", listingId: null, title: "Ford Focus",
      description: "A complete description of this available vehicle.", pricePence: 1000, categorySlug: "car",
      attributes: { make: "Ford" }, ownedImages: [], changes: [],
    })).toBe(true);
    const parsed = stockReviewCorrectionSchema.parse(correction);
    const duplicate = correctStockReviewActions([blocked(), blocked()], parsed);
    expect(duplicate).toEqual({ ok: false, error: "This website vehicle is not a single stable record." });
  });

  it("leaves missing make, model and description blank instead of guessing", () => {
    const draft = stockReviewDraft(blocked());
    expect(draft?.description).toBe("");
    expect(draft?.attributes.make).toBeUndefined();
    expect(draft?.attributes.model).toBeUndefined();
    expect(draft?.attributes.mileage).toBe("12000");
    expect(draft?.photoUrls).toEqual(["https://images.example/car.jpg"]);
  });

  it("rejects invalid price, photos, attributes and protected client fields", () => {
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, price: 50 }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, photoUrls: ["http://images.example/a.jpg"] }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, photoUrls: ["https://127.0.0.1/a.jpg"] }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, photoUrls: ["https://10.0.0.1/a.jpg"] }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, photoUrls: ["https://localhost/a.jpg"] }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, attributes: { "Bad Slug": "x" } }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, reason: "too short" }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, confirmAvailable: false }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, listingId: "listing-1" }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, ownedImages: [] }).success).toBe(false);
    expect(stockReviewCorrectionSchema.safeParse({ ...correction, reviewHash: "abc" }).success).toBe(false);
  });

  it("keeps the original action immutable while changing the corrected fields and fingerprint", () => {
    const original = blocked();
    const before = structuredClone(original);
    const parsed = stockReviewCorrectionSchema.parse(correction);
    const result = correctStockReviewActions([original], parsed);
    expect(original).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.corrected).toMatchObject({
      kind: "create",
      sourceIdentityKey: "sourceVehicleId:abc",
      listingId: null,
      ownedImages: [],
      sourceUrl: "https://dealer.example/focus",
      sourceImageUrls: ["https://images.example/car.jpg"],
      changes: [{ field: "price", before: null, after: 1_250_000 }],
    });
    expect(result.corrected.review?.flags).toEqual([]);
    expect(result.corrected.review?.provenance).toContain("admin-corrected");
    expect(original.review?.flags).toEqual(["missing-description"]);
    expect(fingerprintSnapshot(snapshot(result.actions))).not.toBe(fingerprintSnapshot(snapshot([original])));
    const plan = { actions: [original], reviewSource: { sourceHash: "source", counts: { blocked: 1 } } };
    const next = planAfterCorrection(plan, result.actions);
    expect(plan.reviewSource.counts).toEqual({ blocked: 1 });
    expect(next.reviewSource).toEqual({ sourceHash: "source" });
    expect(next.actions[0]).toMatchObject({ kind: "create" });
  });
});
