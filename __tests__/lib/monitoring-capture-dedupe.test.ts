import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  eventCreate: vi.fn(),
  issueFindUnique: vi.fn(),
  issueUpsert: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    monitoringEvent: {
      findUnique: mocks.eventFindUnique,
      create: mocks.eventCreate,
    },
    monitoringIssue: {
      findUnique: mocks.issueFindUnique,
      upsert: mocks.issueUpsert,
      update: vi.fn(),
    },
    monitoringIssueStatusEvent: { create: vi.fn() },
  },
}));
vi.mock("@/lib/monitoring/alerts", () => ({
  dispatchMonitoringAlerts: mocks.dispatch,
}));
vi.mock("@/lib/monitoring/health", () => ({
  recordCaptureFailure: vi.fn(),
  recordCaptureSuccess: vi.fn(),
}));

import { captureBusinessEvent } from "@/lib/monitoring/capture";

describe("monitoring capture dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: "event-1",
        issue: { id: "issue-1", fingerprint: "fingerprint-1" },
      });
    mocks.issueFindUnique.mockResolvedValue(null);
    mocks.issueUpsert.mockResolvedValue({
      id: "issue-1",
      severity: "HIGH",
      status: "OPEN",
      occurrences: 1,
    });
    mocks.eventCreate.mockResolvedValue({ id: "event-1" });
    mocks.dispatch.mockResolvedValue(undefined);
  });

  it("PAY-MON-DEDUP-006 persists the key and returns the same event on replay", async () => {
    const input = {
      source: "BUSINESS" as const,
      severity: "HIGH" as const,
      message: "A payment checkout is stale.",
      dedupeKey: "stale-payment-attempt:attempt-1",
    };

    const first = await captureBusinessEvent(input);
    const replay = await captureBusinessEvent(input);

    expect(mocks.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: "stale-payment-attempt:attempt-1",
        }),
      }),
    );
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
    expect(first?.eventId).toBe("event-1");
    expect(replay?.eventId).toBe("event-1");
  });
});
