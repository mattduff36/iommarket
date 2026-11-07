import { beforeEach, describe, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { stockReviewDraftReceipt: { findMany } } }));
import { decorateStockDraftReports, loadStockDraftHandoffs } from "@/lib/dealer-stock-sync/draft-handoff-store";

const stamp = new Date("2026-11-07T12:00:00Z");
const listing = { id: "listing", dealerId: "dealer", userId: "owner", status: "DRAFT", stockReviewHeld: false,
  title: "Dealer saved title", soldAt: null, previewPackId: null, retentionPurgedAt: null,
  lifecycleRevision: 3, photoRevision: 2, updatedAt: stamp,
  stockSourceIdentity: { bindingId: "binding", listingId: "listing", sourceIdentityKey: "stock:1" } };
const receipt = { id: "receipt", dealerId: "dealer", userId: "owner", listingId: "listing", reportId: "origin",
  sourceIdentityKey: "stock:1", createdAt: stamp, recalledAt: null, revisionId: null, revision: null, blockers: [], listing };
const action = { kind: "blocked", section: "change", reason: "status-preserved", listingId: "listing", sourceIdentityKey: "stock:1" };
beforeEach(() => { vi.resetAllMocks(); findMany.mockResolvedValue([receipt]); });

describe("current receipt-backed report hydration", () => {
  it("restores origin history and decorates legacy reports without modifying saved fingerprints or other actions", async () => {
    const reports = [
      { id: "origin", dealerId: "dealer", bindingId: "binding", fingerprint: "original", plan: { actions: [] } },
      { id: "later", dealerId: "dealer", bindingId: "binding", fingerprint: "later", plan: { actions: [action, { ...action, listingId: "ordinary", sourceIdentityKey: "stock:2" }] } },
    ];
    const hydrated = await decorateStockDraftReports(reports);
    expect(hydrated[0]).toMatchObject({ fingerprint: "original", plan: { actions: [{ stockDraft: { state: "dealer" } }] } });
    expect(hydrated[1]).toMatchObject({ fingerprint: "later", plan: { actions: [
      { displayTitle: "Dealer saved title", stockDraft: { receiptId: "receipt" } }, reports[1].plan.actions[1],
    ] } });
    expect(reports[0].plan.actions).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: "DRAFT", held: false, recalled: false, state: "dealer" },
    { status: "PENDING", held: false, recalled: false, state: "moderation" },
    { status: "DRAFT", held: true, recalled: true, state: "admin" },
    { status: "LIVE", held: false, recalled: false, state: null },
  ])("uses current persisted state, not stale report metadata: $state", async value => {
    findMany.mockResolvedValue([{ ...receipt, recalledAt: value.recalled ? stamp : null,
      listing: { ...listing, status: value.status, stockReviewHeld: value.held } }]);
    const current = await loadStockDraftHandoffs("dealer", "binding");
    expect(current[0]?.state ?? null).toBe(value.state);
  });
  it("requires current binding and ownership evidence", async () => {
    expect(await loadStockDraftHandoffs("dealer", "foreign")).toEqual([]);
    findMany.mockResolvedValue([{ ...receipt, userId: "foreign" }]);
    expect(await loadStockDraftHandoffs("dealer", "binding")).toEqual([]);
  });
  it("hydrates pending selections without duplicating the same origin-history row", async () => {
    const [report] = await decorateStockDraftReports([{ id: "origin", dealerId: "dealer", bindingId: "binding",
      plan: { actions: [], pendingReviewActions: [action] } }]);
    expect(report.plan.actions).toEqual([]);
    expect(report.plan.pendingReviewActions[0]).toMatchObject({ stockDraft: { state: "dealer" } });
  });
});
