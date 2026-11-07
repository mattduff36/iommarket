import { describe, expect, it } from "vitest";
import { classifyStockDraftHandoff, decorateStockDraftActions } from "@/lib/dealer-stock-sync/draft-handoff";
import { isApprovableStockAction, isDraftableStockAction, isSelectableStockAction } from "@/lib/dealer-stock-sync/selection";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";
import { buildStockSyncPlan } from "@/lib/dealer-stock-sync/plan";

const listing = { id: "listing", dealerId: "dealer", userId: "owner", status: "DRAFT", stockReviewHeld: false,
  soldAt: null, previewPackId: null, retentionPurgedAt: null, featured: false, lifecycleRevision: 3,
  photoRevision: 2, updatedAt: new Date("2026-11-07T12:00:00Z"), title: "Dealer's corrected title" };
const receipt = { id: "receipt", reportId: "origin", dealerId: "dealer", userId: "owner", listingId: "listing",
  revisionId: null, sourceIdentityKey: "stock:1", createdAt: new Date("2026-11-06T12:00:00Z"),
  recalledAt: null, recalledById: null, blockers: ["supply-owned-photos"], revision: null, listing };
const identity = { sourceIdentityKey: "stock:1", listingId: "listing" };
const action: PlanAction = { kind: "blocked", listingId: "listing", sourceIdentityKey: "stock:1", reason: "status-preserved", section: "change" };
const classify = (value: Parameters<typeof classifyStockDraftHandoff>[0] = receipt, link = identity) => classifyStockDraftHandoff(value, link);

describe("receipt-backed stock draft ownership", () => {
  it("plans repeated real scrapes as handoffs, while an ordinary nonlive listing remains blocked", () => {
    const base = { ...listing, price: 10000, mileage: null, expiresAt: null, soldAt: null,
      reviewSourceIdentity: "stock:1", slug: null, previewPackId: null, openRevision: false };
    const vehicle = { sourceIdentityKey: "stock:1", availability: "available" as const, isPoa: false,
      pricePence: 20000, mileage: null, importable: false, skipReason: "missing-price", title: "Scraped title",
      description: null, categorySlug: null, attributes: null, ownedImages: [], remoteImageCount: 0 };
    const previous = { ...identity, absenceCount: 0, lastAbsenceRunId: null, lastSeenRunId: "origin", baselinePricePence: null, baselineMileage: null };
    for (const scrapeRunId of ["second", "third"]) {
      const plan = buildStockSyncPlan({ scrapeRunId, registryKey: "test", regionId: "region",
        vehicles: [vehicle], identities: [previous], listings: [{ ...base, stockDraft: classify()!, updatedAt: base.updatedAt.toISOString() }] });
      expect(plan.actions).toEqual([expect.objectContaining({ kind: "blocked", reason: "awaiting-dealer-review",
        listingId: "listing", stockDraft: expect.objectContaining({ receiptId: "receipt" }) })]);
      expect(plan.actions.some(isDraftableStockAction)).toBe(false);
      expect(plan.actions.some(isApprovableStockAction)).toBe(false);
    }
    const ordinary = buildStockSyncPlan({ scrapeRunId: "next", registryKey: "test", regionId: "region",
      vehicles: [vehicle], identities: [previous], listings: [{ ...base, updatedAt: base.updatedAt.toISOString() }] });
    expect(ordinary.actions[0]).toMatchObject({ kind: "blocked", reason: "status-preserved" });
    expect(ordinary.actions[0].stockDraft).toBeUndefined();
    const sold = buildStockSyncPlan({ scrapeRunId: "sold", registryKey: "test", regionId: "region",
      vehicles: [{ ...vehicle, availability: "sold" }], identities: [previous],
      listings: [{ ...base, stockDraft: classify()!, updatedAt: base.updatedAt.toISOString() }] });
    expect(sold.actions[0]).toMatchObject({ kind: "blocked", reason: "source-sold" });
    expect(sold.actions[0].stockDraft).toBeUndefined();
  });
  it("classifies only an owned, identity-linked receipt, not every non-live listing", () => {
    expect(classify()?.state).toBe("dealer");
    expect(classify({ ...receipt, userId: "another" })).toBeNull();
    expect(classify(receipt, { ...identity, listingId: "other" })).toBeNull();
    expect(decorateStockDraftActions([action], [], "new")).toEqual([action]);
  });
  it("separates submitted moderation from awaiting dealer drafts", () => {
    expect(classify({ ...receipt, listing: { ...listing, status: "PENDING" } })?.state).toBe("moderation");
    expect(classify({ ...receipt, listing: { ...listing, status: "LIVE" } })).toBeNull();
    expect(classify({ ...receipt, listing: { ...listing, status: "SOLD", soldAt: new Date() } })).toBeNull();
  });
  it("decorates a legacy report and repeated scrape without allowing duplicate handoff or approval", () => {
    const handoff = classify()!;
    for (const reportId of ["legacy", "next-scrape"]) {
      const [row] = decorateStockDraftActions([action], [handoff], reportId);
      expect(row.stockDraft?.receiptId).toBe("receipt");
      expect(isSelectableStockAction(row)).toBe(false);
      expect(isDraftableStockAction(row)).toBe(false);
      expect(isApprovableStockAction(row)).toBe(false);
    }
  });
  it("restores history on the originating report after To drafts removed the action", () => {
    const rows = decorateStockDraftActions([], [classify()!], "origin");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listingId: "listing", sourceIdentityKey: "stock:1", stockDraft: { state: "dealer" } });
    expect(decorateStockDraftActions([], [classify()!], "unrelated")).toEqual([]);
  });
  it("does not conceal genuine protection or identity conflicts", () => {
    const protectedRow = { ...action, reason: "duplicate-managed-listing" } as PlanAction;
    expect(decorateStockDraftActions([protectedRow], [classify()!], "origin")).toEqual([protectedRow]);
  });
  it("identifies recalled drafts and live revision handoffs explicitly", () => {
    expect(classify({ ...receipt, recalledAt: new Date(), listing: { ...listing, stockReviewHeld: true } })?.state).toBe("admin");
    expect(classify({ ...receipt, revisionId: "revision", listing: { ...listing, status: "LIVE" },
      revision: { id: "revision", listingId: "listing", status: "DRAFT", version: 4 } })?.revisionId).toBe("revision");
  });
});
