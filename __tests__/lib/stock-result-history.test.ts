import { describe, expect, it } from "vitest";
import { canManageStockReport, isGenuineNoChangeReview, resultHistoryState } from "@/lib/dealer-stock-sync/result-history";

describe("stock result history policy", () => {
  it("requires a valid genuine no-change plan and does not confuse manageable missing observations with no work", () => {
    const unchanged = { kind: "unchanged", sourceIdentityKey: "sourceVehicleId:same", listingId: null };
    const sold = { kind: "blocked", sourceIdentityKey: "sourceVehicleId:sold", listingId: null, reason: "source-sold", section: "new" };
    for (const status of ["PENDING_REVIEW", "SUPERSEDED", "REJECTED"]) {
      for (const actions of [[], [unchanged], [sold], [unchanged, sold]]) {
        const plan = { actions };
        expect(isGenuineNoChangeReview(status, plan)).toBe(true);
        for (const event of [null, "RESULT_ARCHIVED", "RESULT_RESTORED"]) expect(resultHistoryState(status, event, plan)).toBe("archived");
        expect(resultHistoryState(status, "RESULT_DELETED", plan)).toBe("deleted");
      }
    }
    for (const plan of [null, {}, { actions: null }, { actions: [null] }, { actions: [{ kind: "unchanged" }] },
      { actions: [], pendingReviewActions: "broken" }, { actions: [], pendingReviewActions: [{ kind: "blocked" }] },
      { actions: [{ ...unchanged, stockDraft: { state: "dealer" } }] },
      ...["awaiting-dealer-review", "submitted-dealer-review", "admin-stock-review"].map(reason => ({ actions: [{ ...sold, reason, review: { availability: "sold", flags: [] } }] })),
      ...["missing_once", "unpublish", "conflict", "blocked", "create", "update"].map(kind => ({ actions: [{ ...unchanged, kind }] }))]) {
      expect(isGenuineNoChangeReview("PENDING_REVIEW", plan)).toBe(false);
      expect(resultHistoryState("PENDING_REVIEW", null, plan)).toBe("active");
    }
    for (const status of ["FAILED", "APPROVED"]) {
      expect(isGenuineNoChangeReview(status, { actions: [] })).toBe(false);
      expect(resultHistoryState(status, null, { actions: [] })).toBe("active");
    }
  });
  it("keeps receipt-backed ownership visible and unarchivable while dealer/admin/moderation work is pending", () => {
    for (const state of ["dealer", "admin", "moderation"]) {
      for (const key of ["actions", "pendingReviewActions"]) {
        const plan = { [key]: [{ kind: "blocked", stockDraft: { state } }] };
        expect(resultHistoryState("REJECTED", "RESULT_DELETED", plan)).toBe("active");
        expect(canManageStockReport("APPLIED", plan)).toBe(false);
      }
    }
  });
  it("retains unprocessed selection remainder even after failed jobs or archive requests", () => {
    const plan = { actions: [], pendingReviewActions: [{ kind: "blocked", reason: "missing-price" }] };
    for (const status of ["APPROVED", "FAILED", "APPLIED"]) {
      expect(resultHistoryState(status, "RESULT_ARCHIVED", plan)).toBe("active");
      expect(canManageStockReport(status, plan)).toBe(false);
    }
  });
  it("allows superseded snapshots to be archived, deleted and restored despite old pending work", () => {
    const plan = { actions: [{ kind: "blocked", stockDraft: { state: "dealer" } }], pendingReviewActions: [{ kind: "blocked", reason: "missing-price" }] };
    expect(canManageStockReport("SUPERSEDED", plan)).toBe(true);
    expect(resultHistoryState("SUPERSEDED", "RESULT_ARCHIVED", plan)).toBe("archived");
    expect(resultHistoryState("SUPERSEDED", "RESULT_DELETED", plan)).toBe("deleted");
    expect(resultHistoryState("SUPERSEDED", "RESULT_RESTORED", plan)).toBe("active");
    expect(canManageStockReport("PENDING_REVIEW", plan)).toBe(false);
  });
  it("automatically archives applied and genuine no-change reports", () => {
    expect(resultHistoryState("APPLIED", null)).toBe("archived");
    expect(resultHistoryState("PENDING_REVIEW", null)).toBe("active");
    expect(resultHistoryState("APPLIED", "RESULT_DELETED")).toBe("deleted");
    expect(resultHistoryState("APPLIED", "RESULT_RESTORED")).toBe("active");
    expect(resultHistoryState("REJECTED", null)).toBe("archived");
    expect(resultHistoryState("SUPERSEDED", null, {actions:[{kind:"unchanged", sourceIdentityKey:"sourceVehicleId:same", listingId:null}]})).toBe("archived");
    expect(resultHistoryState("PENDING_REVIEW", null, {actions:[]})).toBe("archived");
    expect(resultHistoryState("PENDING_REVIEW", "RESULT_RESTORED", {actions:[]})).toBe("archived");
    expect(resultHistoryState("FAILED", null, {actions:[]})).toBe("active");
    expect(resultHistoryState("APPROVED", null, {actions:[]})).toBe("active");
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
