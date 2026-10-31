import { describe, expect, it } from "vitest";
import { canManageStockReport, resultHistoryState } from "@/lib/dealer-stock-sync/result-history";

describe("stock result history policy", () => {
  it("retains unprocessed selection remainder even after failed jobs or archive requests", () => {
    const plan = { actions: [], pendingReviewActions: [{ kind: "blocked", reason: "missing-price" }] };
    for (const status of ["APPROVED", "FAILED", "APPLIED", "SUPERSEDED"]) {
      expect(resultHistoryState(status, "RESULT_ARCHIVED", plan)).toBe("active");
      expect(canManageStockReport(status, plan)).toBe(false);
    }
  });
  it("automatically archives applied reports but leaves no-change reports active", () => {
    expect(resultHistoryState("APPLIED", null)).toBe("archived");
    expect(resultHistoryState("PENDING_REVIEW", null)).toBe("active");
    expect(resultHistoryState("APPLIED", "RESULT_DELETED")).toBe("deleted");
    expect(resultHistoryState("APPLIED", "RESULT_RESTORED")).toBe("active");
    expect(resultHistoryState("REJECTED", null)).toBe("archived");
    expect(resultHistoryState("SUPERSEDED", null, {actions:[{kind:"unchanged"}]})).toBe("active");
  });
  it("allows no-change history management without allowing actionable reviews or approved work", () => {
    expect(canManageStockReport("PENDING_REVIEW", { actions: [{kind:"unchanged"}] })).toBe(true);
    expect(canManageStockReport("PENDING_REVIEW", { actions: [{kind:"create"}] })).toBe(false);
    expect(canManageStockReport("PENDING_REVIEW", { actions: [{kind:"conflict"}] })).toBe(false);
    expect(canManageStockReport("APPROVED", { actions: [] })).toBe(false);
    expect(canManageStockReport("APPLIED", { actions: [{kind:"create"}] })).toBe(true);
    expect(canManageStockReport("FAILED", null)).toBe(true);
    expect(canManageStockReport("PENDING_REVIEW", null)).toBe(false);
  });
});
