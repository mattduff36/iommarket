import { describe, expect, it } from "vitest";
import { applyRecoveryState, recoverySchema } from "@/lib/dealer-stock-sync/apply-recovery";
const report = { id: "report", dealerId: "dealer", bindingId: "binding", fingerprint: "a".repeat(64), status: "APPROVED" };
const attempt = { id: "failed", kind: "APPLY", status: "FAILED", reportId: report.id, bindingId: report.bindingId, dealerId: report.dealerId, payload: { reportId: report.id, fingerprint: report.fingerprint, desktopApply: { deletedMedia: true } } };
describe("report-owned apply recovery", () => {
  it.each(["FAILED", "CANCELLED"])("recovers an approved report after %s, independently of history visibility", status => {
    expect(applyRecoveryState(report, { ...attempt, status }, null)).toMatchObject({ retryable: true, attempt: { id: "failed", status } });
  });
  it.each(["QUEUED", "LEASED"])("does not offer competing recovery during %s", status => {
    expect(applyRecoveryState(report, attempt, { id: "active", kind: "SCRAPE", status }).retryable).toBe(false);
  });
  it("requires a fresh check when an attempt is absent rather than inferring a failure", () => {
    expect(applyRecoveryState(report, null, null)).toMatchObject({ retryable: false, reason: expect.stringContaining("fresh check") });
  });
  it.each([
    { payload: { fingerprint: "b".repeat(64), reportId: report.id } },
    { payload: { fingerprint: report.fingerprint } },
    { dealerId: "other" }, { bindingId: "other" }, { reportId: "other" }, { kind: "SCRAPE" }, { status: "SUCCEEDED" },
  ])("does not retry an invalid or mismatched attempt %j", patch => {
    expect(applyRecoveryState(report, { ...attempt, ...patch }, null).retryable).toBe(false);
  });
  it("validates stale-click fencing and rejects extra client fields", () => {
    expect(recoverySchema.safeParse({ ...report, operation: "retry", expectedJobId: "failed" }).success).toBe(false);
    expect(recoverySchema.safeParse({ reportId: report.id, fingerprint: report.fingerprint, operation: "retry" }).success).toBe(false);
    expect(recoverySchema.safeParse({ reportId: report.id, fingerprint: report.fingerprint, operation: "fresh" }).success).toBe(true);
  });
});
