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

  it.each(["provider:external", "provider:imagekit", "provider:supabase"])("preserves the exact resource provider token %s", (filename) => {
    expect(safeEventEvidence({ filename })).toEqual({ scriptLocation: filename, browserFamily: "unknown" });
  });

  it.each(["provider:private", "provider:external?secret=value", "provider:imagekit/private", "provider:supabase#private"])(
    "does not accept modified or unallowlisted provider tokens (%#)", (filename) => {
      expect(safeEventEvidence({ filename })).toEqual({ scriptLocation: "unavailable", browserFamily: "unknown" });
    },
  );

  it("exports only the explicitly correlated request and its closed failure facts", () => {
    const row = {
      triggeringRequest: {
        at: 123, target: "/api/media/listing-photo", method: "GET", status: null, durationMs: 2,
        outcome: "network-error", errorCategory: "TypeError", signalAborted: true,
        url: "https://private.test?secret=value", message: "private", abortReason: "private",
      },
      requests: [{ at: 456, target: "/search", method: "GET", status: 503, durationMs: 1, outcome: "http-error" }],
    };
    expect(safeEventEvidence(row)).toEqual({
      triggeringRequestAt: 123, triggeringRequestTarget: "/api/media/listing-photo", triggeringRequestMethod: "GET",
      triggeringRequestDurationMs: 2, triggeringRequestOutcome: "network-error",
      triggeringRequestErrorCategory: "TypeError", triggeringRequestSignalAborted: true, browserFamily: "unknown",
    });
    expect(safeEventEvidence({ requests: row.requests })).toEqual({ browserFamily: "unknown" });
    expect(safeEventEvidence({ triggeringRequest: { ...row.triggeringRequest, target: "https://private.test" } }))
      .toEqual({ browserFamily: "unknown" });
    const httpEvidence = safeEventEvidence({ triggeringRequest: {
      ...row.triggeringRequest, status: 503, outcome: "http-error", requestId: "failed-request-123",
      errorCategory: "private", signalAborted: "true",
    } });
    expect(httpEvidence).toMatchObject({ triggeringRequestStatus: 503, triggeringRequestRequestId: "failed-request-123" });
    expect(httpEvidence).not.toHaveProperty("triggeringRequestErrorCategory");
    expect(httpEvidence).not.toHaveProperty("triggeringRequestSignalAborted");
    expect(JSON.stringify(httpEvidence)).not.toMatch(/private|secret|message|abortReason/);
  });

  it("exports flattened closed resource facts without URLs, identifiers or error contents", () => {
    expect(safeEventEvidence({ resource: {
      elementKind: "video", target: "provider:imagekit", mediaErrorCode: 3,
      responseStatus: 0, durationMs: 12, transferSize: 0, decodedBodySize: 300,
      url: "https://private.test?secret=value", id: "private", alt: "private", message: "private", body: "private",
    } })).toEqual({
      resourceElementKind: "video", resourceTarget: "provider:imagekit", resourceMediaErrorCode: 3,
      resourceResponseStatus: 0, resourceDurationMs: 12, resourceTransferSize: 0, resourceDecodedBodySize: 300,
      browserFamily: "unknown",
    });
    expect(safeEventEvidence({ resource: {
      elementKind: "link", target: "/_next/static/chunks/:segment", linkRel: "stylesheet", linkAs: "style",
    } })).toMatchObject({ resourceElementKind: "link", resourceLinkRel: "stylesheet", resourceLinkAs: "style" });
    expect(safeEventEvidence({ resource: {
      elementKind: "img", target: "https://private.test?secret=value", responseStatus: 500, transferSize: 1e20,
    } })).toEqual({ resourceElementKind: "img", browserFamily: "unknown" });
    expect(safeEventEvidence({ resource: { elementKind: "private", target: "/search" } })).toEqual({ browserFamily: "unknown" });
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
