import { describe, expect, it } from "vitest";
import { blockedDismissalEvidence, omitDismissedBlockedActions } from "@/lib/dealer-stock-sync/blocked-dismissals";
import { stableStockContentSignature } from "@/lib/dealer-stock-sync/stock-content-signature";
import type { FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { PlanAction, ReviewedActionEvidence, SyncListing } from "@/lib/dealer-stock-sync/types";

const review = (overrides: Partial<ReviewedActionEvidence> = {}): ReviewedActionEvidence => ({
  displayTitle: "2020 Ford Focus", description: "Original advert", attributes: { colour: "Blue" },
  fuel: "Petrol", transmission: "Manual", flags: ["needs-review"], pricePence: 100000,
  mileage: 12000, year: 2020, categorySlug: "car", sourceUrl: "https://dealer.example/focus",
  safePhotoUrls: ["https://images.example/car.jpg?version=1&X-Amz-Signature=old&X-Amz-Date=20261108"],
  availability: "available", provenance: ["used", "cars"], sourceHash: "document-hash",
  capturedAt: "2026-11-08T00:00:00.000Z", coverageWarning: null, capacityWarning: null, ...overrides,
});
const blocked = (overrides: Partial<Extract<PlanAction, { kind: "blocked" }>> = {}): PlanAction => ({
  kind: "blocked", sourceIdentityKey: "sourceVehicleId:abc", listingId: null,
  reason: "review-flag", section: "new", review: review(), ...overrides,
});
const snapshot = (actions: PlanAction[] = [blocked()]): FingerprintSnapshot => ({
  dealer: { id: "dealer", userId: "owner", regionId: "region", tier: "PRO", isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
  binding: { id: "binding", registryKey: "dw-cars", enabled: false, verifiedAt: null },
  activeListingCount: 0, listingCap: 30, listings: [], identities: [], actions,
});
const audit = (saved: FingerprintSnapshot) => ({ before: { actions: saved.actions, blockedDismissals: blockedDismissalEvidence(saved, saved.actions) } });
const filter = (fresh: FingerprintSnapshot, saved = snapshot()) => omitDismissedBlockedActions(fresh, [audit(saved)]);
const listing = (id: string): SyncListing => ({ id, status: "LIVE", price: 100000, mileage: 12000, featured: false, expiresAt: null, soldAt: null, lifecycleRevision: 1, photoRevision: 1, reviewSourceIdentity: "sourceVehicleId:abc", slug: null, previewPackId: null, openRevision: false });

describe("durable blocked dismissals", () => {
  it("preserves image identity/content/version parameters while normalizing only known expiring signatures", () => {
    const saved = snapshot([blocked({ review: review({ safePhotoUrls: ["https://images.example/car.jpg?token=identity&v=1&Expires=10&Signature=old"] }) })]);
    const fresh = snapshot([blocked({ review: review({ safePhotoUrls: ["https://images.example/car.jpg?Signature=new&Expires=20&v=1&token=identity"] }) })]);
    expect(filter(fresh, saved)).toEqual([]);
    expect(filter(snapshot([blocked({ review: review({ safePhotoUrls: ["https://images.example/car.jpg?token=different&v=1"] }) })]), saved)).toHaveLength(1);
  });
  it("suppresses unchanged evidence while ignoring run, document hash, provenance order and signed URL expiry", () => {
    const fresh = snapshot([blocked({ review: review({ sourceHash: "another-document", capturedAt: "2026-11-09", provenance: ["cars", "used"], safePhotoUrls: ["https://images.example/car.jpg?X-Amz-Date=20261109&X-Amz-Signature=new&version=1"] }) })]);
    fresh.activeListingCount = 19;
    fresh.listings = [{ ...listing("unrelated"), reviewSourceIdentity: "other" }];
    expect(filter(fresh)).toEqual([]);
  });
  it.each([
    { pricePence: 200000 }, { mileage: 13000 }, { description: "Changed advert" },
    { attributes: { colour: "Red" } }, { fuel: "Diesel" }, { transmission: "Automatic" },
    { safePhotoUrls: ["https://images.example/car.jpg?version=2"] }, { availability: "reserved" as const },
  ])("resurfaces changed source facts %j", change => {
    const fresh = snapshot([blocked({ review: review(change) })]);
    expect(filter(fresh)).toEqual(fresh.actions);
  });
  it("resurfaces reason, section, source identity and exact scope changes", () => {
    for (const action of [blocked({ reason: "missing-price" }), blocked({ section: "other" }), blocked({ sourceIdentityKey: "sourceVehicleId:other" })]) {
      expect(filter(snapshot([action]))).toEqual([action]);
    }
    for (const fresh of [
      { ...snapshot(), dealer: { ...snapshot().dealer, id: "other" } },
      { ...snapshot(), binding: { ...snapshot().binding, id: "other" } },
      { ...snapshot(), binding: { ...snapshot().binding, registryKey: "other" } },
    ]) expect(filter(fresh)).toEqual(fresh.actions);
  });
  it("compares linked listing protection and identity baseline, but not absence bookkeeping", () => {
    const saved = { ...snapshot([blocked({ listingId: "listing", section: "change" })]), listings: [listing("listing")], identities: [{ sourceIdentityKey: "sourceVehicleId:abc", listingId: "listing", baselinePricePence: 100000, baselineMileage: 12000, absenceCount: 0, lastAbsenceRunId: null, lastSeenRunId: "old" }] };
    const fresh = { ...saved,
      listings: [{ ...listing("listing"), updatedAt: "2026-11-09T00:00:00.000Z", expiresAt: "2026-12-09T00:00:00.000Z" }],
      identities: saved.identities.map(item => ({ ...item, absenceCount: 3, lastSeenRunId: "new", lastAbsenceRunId: "new" })),
    };
    expect(filter(fresh, saved)).toEqual([]);
    for (const changes of [{ price: 200000 }, { photoRevision: 2 }, { soldAt: "2026-11-09T00:00:00.000Z" }, { openRevision: true }, { stockReviewHeld: true }, { status: "TAKEN_DOWN" }, { description: "Local edit" }]) {
      const changed = { ...fresh, listings: [{ ...listing("listing"), ...changes }] };
      expect(filter(changed, saved)).toEqual(changed.actions);
    }
    const changed = { ...fresh, identities: fresh.identities.map(item => ({ ...item, baselineMileage: 1 })) };
    expect(filter(changed, saved)).toEqual(changed.actions);
  });
  it("preserves absence tracking and resurfaces resolved missing blocks", () => {
    const missing = blocked({ listingId: "listing", section: "missing", reason: "paid-feature", review: undefined });
    const identity = { sourceIdentityKey: "sourceVehicleId:abc", listingId: "listing", baselinePricePence: 100000, baselineMileage: 12000, absenceCount: 2, lastAbsenceRunId: "old", lastSeenRunId: "seen" };
    const saved = { ...snapshot([missing]), listings: [{ ...listing("listing"), featured: true }], identities: [identity] };
    const fresh = { ...saved, identities: [{ ...identity, absenceCount: 5, lastAbsenceRunId: "new" }] };
    expect(filter(fresh, saved)).toEqual([]);
    expect(fresh.identities[0].absenceCount).toBe(5);
    const resolved: PlanAction = { kind: "unpublish", sourceIdentityKey: identity.sourceIdentityKey, listingId: "listing", absenceCount: 5, lifecycleRevision: 1 };
    expect(filter({ ...fresh, actions: [resolved], listings: [listing("listing")] }, saved)).toEqual([resolved]);
  });
  it("fails open on ambiguous local mappings and duplicate listing rows", () => {
    const action = blocked({ listingId: "listing" });
    const identity = { sourceIdentityKey: "sourceVehicleId:abc", listingId: "listing", baselinePricePence: 100000, baselineMileage: 12000, absenceCount: 0, lastAbsenceRunId: null, lastSeenRunId: null };
    for (const saved of [
      { ...snapshot([action]), listings: [listing("listing")], identities: [identity, identity] },
      { ...snapshot([action]), listings: [listing("listing")], identities: [identity, { ...identity, sourceIdentityKey: "sourceVehicleId:other" }] },
      { ...snapshot([action]), listings: [listing("listing"), listing("listing")], identities: [identity] },
    ]) expect(filter(saved, saved)).toEqual(saved.actions);
  });
  it("compares all duplicate-managed listings, independent of their arbitrary first match", () => {
    const conflict: PlanAction = { kind: "conflict", reason: "duplicate-managed-listing", sourceIdentityKey: "sourceVehicleId:abc", listingId: "one", changes: [], review: review() };
    const saved = { ...snapshot([conflict]), listings: [listing("one"), listing("two")] };
    const fresh = { ...saved, actions: [{ ...conflict, listingId: "two" }], listings: [...saved.listings].reverse() };
    expect(filter(fresh, saved)).toEqual([]);
    expect(filter({ ...fresh, listings: [listing("two"), { ...listing("one"), photoRevision: 2 }] }, saved)).toEqual(fresh.actions);
  });
  it("fails open for legacy, malformed or insufficient newer evidence without falling back", () => {
    const saved = snapshot();
    for (const before of [null, { actions: saved.actions }, { actions: saved.actions, blockedDismissals: { version: 2 } }, { actions: saved.actions, blockedDismissals: { ...blockedDismissalEvidence(saved, saved.actions), entries: [] } }]) {
      expect(omitDismissedBlockedActions(saved, [{ before }, audit(saved)])).toEqual(saved.actions);
    }
    expect(filter(snapshot([blocked({ review: undefined })]))).toHaveLength(1);
    const incomplete = snapshot([blocked({ review: review({ description: undefined, attributes: undefined }) })]);
    expect(filter(incomplete, incomplete)).toEqual(incomplete.actions);
    const corrected = snapshot([blocked({ review: review({ provenance: ["admin-corrected"] }) })]);
    expect(filter(corrected, corrected)).toEqual(corrected.actions);
    const malformed = snapshot([blocked({ review: review({ sourceSignature: { version: 1, digest: "invalid" } }) })]);
    expect(filter(malformed, malformed)).toEqual(malformed.actions);
  });
  it("never suppresses duplicate/unstable identities, other action kinds or draft ownership", () => {
    const saved = snapshot();
    const create: PlanAction = { kind: "create", sourceIdentityKey: "sourceVehicleId:abc", listingId: null, title: "Car", description: "Car", pricePence: 1, categorySlug: "car", attributes: {}, ownedImages: [], changes: [] };
    const other: PlanAction[] = [create, { kind: "update", sourceIdentityKey: "sourceVehicleId:abc", listingId: "l", changes: [], lifecycleRevision: 1, photoRevision: 1, featured: false }, { kind: "missing_once", sourceIdentityKey: "sourceVehicleId:abc", listingId: null, absenceCount: 1 }, { kind: "unpublish", sourceIdentityKey: "sourceVehicleId:abc", listingId: "l", absenceCount: 2, lifecycleRevision: 1 }];
    for (const action of other) expect(filter(snapshot([action]), saved)).toEqual([action]);
    for (const action of [blocked({ sourceIdentityKey: null }), blocked({ sourceIdentityKey: "composite:abc" }), blocked({ reason: "duplicate-source" })]) expect(filter(snapshot([action]), snapshot([action]))).toEqual([action]);
    expect(filter(snapshot([blocked(), blocked()]))).toHaveLength(2);
    const handoff = { receiptId: "receipt", dealerId: "dealer", reportId: "report", listingId: "draft", sourceIdentityKey: "sourceVehicleId:abc",
      revisionId: null, state: "dealer" as const, sentAt: "2026-11-08", recalledAt: null, blockers: [], title: "Ford Focus",
      lifecycleRevision: 1, photoRevision: 1, updatedAt: "2026-11-08", revisionVersion: null };
    const owned = { ...saved, listings: [{ ...listing("draft"), stockDraft: handoff }] };
    expect(filter(owned)).toEqual(owned.actions);
    const direct = snapshot([blocked({ stockDraft: handoff })]);
    expect(filter(direct, direct)).toEqual(direct.actions);
    for (const reason of ["awaiting-dealer-review", "submitted-dealer-review", "admin-stock-review"]) {
      const pending = snapshot([blocked({ reason })]);
      expect(filter(pending, pending)).toEqual(pending.actions);
    }
  });
  it("uses a frozen raw signature rather than admin-corrected display facts", () => {
    const sourceSignature = { version: 1 as const, digest: stableStockContentSignature({ description: "raw" }) };
    const saved = snapshot([blocked({ review: review({ sourceSignature, displayTitle: "Admin corrected", description: "Corrected", provenance: ["admin-corrected"] }) })]);
    const fresh = snapshot([blocked({ review: review({ sourceSignature }) })]);
    expect(filter(fresh, saved)).toEqual([]);
    expect(filter(snapshot([blocked({ review: review({ sourceSignature: { ...sourceSignature, digest: "b".repeat(64) } }) })]), saved)).toHaveLength(1);
  });
});
