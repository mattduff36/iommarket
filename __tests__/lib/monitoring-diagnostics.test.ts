import { describe, expect, it } from "vitest";
import { signInDiagnostics } from "@/lib/monitoring/client-diagnostics";
import { safeEventEvidence } from "@/scripts/fixerrors/evidence";
import { acknowledgedBacklogReport } from "@/scripts/fixerrors/backlog";
import type { PgClientLike } from "@/scripts/fixerrors/types";

describe("actionable monitoring evidence", () => {
  it("keeps provider categories and valid status, never arbitrary error contents", () => {
    expect(signInDiagnostics({ code: "invalid_credentials", status: 400 })).toEqual({
      operation: "sign-in", authCode: "invalid_credentials", httpStatus: 400,
    });
    expect(signInDiagnostics({ code: "password=private", status: NaN })).toEqual({ operation: "sign-in", authCode: "other" });
    expect(signInDiagnostics({ status: 999 }).httpStatus).toBeUndefined();
  });

  it("exports only allowlisted facts and strips secrets, bodies, query strings and unknown codes", () => {
    const evidence = safeEventEvidence({
      diagnostics: { online: false, visibility: "hidden", operation: "sign-in", authCode: "invalid_credentials", httpStatus: 400, password: "private" },
      requestId: "req_12345678", ingestRelease: "a".repeat(40),
      userAgent: "Mozilla/5.0 Safari/605.1 secret=private",
      displayedSupportReference: "event_12345678", clientStackProvided: "false", extra: { password: "private" },
    });
    expect(evidence).toMatchObject({ online: false, browserFamily: "Safari", authCode: "invalid_credentials", httpStatus: 400, clientStackProvided: false });
    expect(JSON.stringify(evidence)).not.toMatch(/private|password|Mozilla/);
    expect(safeEventEvidence({ diagnostics: { online: "true", authCode: "private", httpStatus: 0 }, requestId: "https://host/?token=private", ingestRelease: "unknown" }))
      .toEqual({ browserFamily: "unknown" });
  });

  it("exports safe payment failure facts without provider payloads or private references", () => {
    expect(safeEventEvidence({ rejectStage: "envelope", envReason: "ccy", ccyState: "missing", attemptNumber: "2", receiptAgeMs: "5000", processingState: "FAILED", body: "private", paymentReference: "private" })).toMatchObject({ rejectStage: "envelope", envReason: "ccy", ccyState: "missing", attemptNumber: 2, receiptAgeMs: 5000, processingState: "FAILED" });
    expect(safeEventEvidence({ inboxId: "person@example.com", errorCode: "private", rejectStage: "password", receiptAgeMs: "secret", body: "private" })).toEqual({ browserFamily: "unknown" });
  });

  it("keeps acknowledged work visible with notes without granting mutation authority", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => {
      queries.push(sql);
      return { rows: [{ id: "issue-1", sampleMessage: "Load failed", sampleRoute: "/admin/listings", occurrences: 2, eventCount: 0, notes: "Collect a failed-request trace" }], rowCount: 1 };
    } } as PgClientLike;
    const report = await acknowledgedBacklogReport(client);
    expect(queries[0]).toContain("issue.status = 'ACKNOWLEDGED'");
    expect(queries[0]).toContain('to_char(issue."lastSeenAt"');
    expect(queries[0]).not.toMatch(/UPDATE |DELETE |INSERT /);
    expect(report).toContain("Acknowledged does not mean fixed");
    expect(report).toContain("Retained events: 0");
    expect(report).toContain("Collect a failed-request trace");
  });
});
