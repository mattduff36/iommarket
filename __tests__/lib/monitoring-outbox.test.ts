import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const recordAlertSuccess = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    monitoringAlertDelivery: { findMany, updateMany, update },
    monitoringIssue: { update: vi.fn() },
  },
}));

vi.mock("@/lib/monitoring/health", () => ({
  recordAlertSuccess,
  recordAlertFailure: vi.fn(),
}));

describe("monitoring alert outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue({});
    recordAlertSuccess.mockResolvedValue(undefined);
  });

  it("claims a dry-run canary and marks it sent without a network call", async () => {
    findMany.mockResolvedValue([{
      id: "delivery-1",
      issueId: "issue-1",
      channel: "EMAIL",
      kind: "CANARY",
      target: "alerts@example.com",
      attempts: 0,
      status: "PENDING",
      payload: {
        subject: "canary",
        text: "canary",
        webhookBody: { type: "monitoring_canary" },
        dryRun: true,
      },
    }]);
    const sendEmail = vi.fn();
    const { processMonitoringAlertOutbox } = await import("@/lib/monitoring/alert-outbox");

    const result = await processMonitoringAlertOutbox({ sendEmail });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENT" }),
    }));
  });

  it("exhausts a permanently rejected webhook so it is not retried", async () => {
    findMany.mockResolvedValue([{
      id: "delivery-2",
      issueId: "issue-1",
      channel: "WEBHOOK",
      kind: "IMMEDIATE",
      target: "http://127.0.0.1/hook",
      attempts: 0,
      status: "PENDING",
      payload: {
        subject: "alert",
        text: "alert",
        webhookBody: { type: "monitoring_alert" },
      },
    }]);
    const { processMonitoringAlertOutbox } = await import("@/lib/monitoring/alert-outbox");
    const result = await processMonitoringAlertOutbox({
      webhookSecret: "secret",
      lookupHost: async () => ["127.0.0.1"],
    });

    expect(result.failed).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", attempts: 5, nextAttemptAt: null }),
    }));
  });
});
