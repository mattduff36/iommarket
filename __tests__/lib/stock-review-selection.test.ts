import { describe, expect, it } from "vitest";
import { selectReviewActions, isApprovableStockAction, isDraftableStockAction } from "@/lib/dealer-stock-sync/selection";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

const actions = [
  { kind: "create", sourceIdentityKey: "new", listingId: null },
  { kind: "blocked", sourceIdentityKey: "blocked", listingId: null, section: "new", reason: "missing-price" },
  { kind: "unpublish", sourceIdentityKey: "old", listingId: "listing" },
] as PlanAction[];

describe("stock review selection", () => {
  it("supports all 2,000 report rows while retaining a bounded payload", () => {
    const rows = Array.from({ length: 2000 }, () => actions[0]);
    expect(selectReviewActions(rows, rows.map((_, index) => index)).selected).toHaveLength(2000);
    expect(() => selectReviewActions([...rows, actions[0]], Array.from({ length: 2001 }, (_, index) => index))).toThrow();
  });
  it("selects original indexes without moving or dropping unselected rows", () => {
    expect(selectReviewActions(actions, [1])).toEqual({ selected: [actions[1]], remaining: [actions[0], actions[2]] });
  });
  it("rejects duplicate, absent and out-of-range selections", () => {
    for (const indexes of [[], [1, 1], [3], [-1], [0.5]]) expect(() => selectReviewActions(actions, indexes)).toThrow();
  });
  it("never approves blocked stock or implicitly approves removals", () => {
    expect(actions.map(isApprovableStockAction)).toEqual([true, false, false]);
  });
  it("allows incomplete new drafts but preserves sold and ambiguous stock", () => {
    expect(isDraftableStockAction(actions[1])).toBe(true);
    expect(isDraftableStockAction({ ...actions[1], sourceIdentityKey: null } as PlanAction)).toBe(false);
    expect(isDraftableStockAction({ ...actions[1], reason: "sold-preserved" } as PlanAction)).toBe(false);
    expect(isDraftableStockAction({ ...actions[1], reason: "duplicate-managed-listing" } as PlanAction)).toBe(false);
  });
});
