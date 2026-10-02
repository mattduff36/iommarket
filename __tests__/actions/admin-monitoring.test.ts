import { beforeEach, describe, expect, it, vi } from "vitest";

const ISSUE_ID = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
const EVENT_ID = "clyyyyyyyyyyyyyyyyyyyyyyyy";
const DELIVERY_ID = "clzzzzzzzzzzzzzzzzzzzzzzz";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  captureExceptionMock,
  processOutboxMock,
  mockDb,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  processOutboxMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    monitoringIssue: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    monitoringIssueStatusEvent: {
      create: vi.fn(),
    },
    monitoringEvent: {
      findUnique: vi.fn(),
    },
    monitoringAlertDelivery: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: logAdminActionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/monitoring/alert-outbox", () => ({
  processMonitoringAlertOutbox: processOutboxMock,
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

describe("admin monitoring actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) =>
      callback(mockDb),
    );
    mockDb.monitoringIssue.findUnique.mockResolvedValue({
      status: "OPEN",
      severity: "HIGH",
    });
    mockDb.monitoringIssue.update.mockResolvedValue({ id: ISSUE_ID, status: "ACKNOWLEDGED" });
    mockDb.monitoringIssueStatusEvent.create.mockResolvedValue({ id: "status-1" });
    logAdminActionMock.mockResolvedValue(undefined);
    processOutboxMock.mockResolvedValue({ processed: 1, sent: 1, failed: 0 });
  });

  it("stores acknowledgement severity so unchanged repeats can be suppressed", async () => {
    const { setMonitoringIssueStatus } = await import("@/actions/admin/monitoring");
    const result = await setMonitoringIssueStatus({
      issueId: ISSUE_ID,
      status: "ACKNOWLEDGED",
      notes: "Watching this",
    });

    expect(result).toEqual({ data: { id: ISSUE_ID, status: "ACKNOWLEDGED" } });
    expect(mockDb.monitoringIssue.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ACKNOWLEDGED",
        acknowledgedSeverity: "HIGH",
        assigneeAdminId: "cladminxxxxxxxxxxxxxxxxxx",
      }),
    }));
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "SET_MONITORING_ISSUE_STATUS",
    }));
  });

  it("audits privileged identity reveal", async () => {
    mockDb.monitoringEvent.findUnique.mockResolvedValue({
      id: EVENT_ID,
      issueId: ISSUE_ID,
      userId: "user-1",
      userEmail: "seller@example.com",
      ipHash: "hash",
    });
    const { revealMonitoringEventIdentity } = await import("@/actions/admin/monitoring");
    const result = await revealMonitoringEventIdentity(EVENT_ID);

    expect(result).toEqual({
      data: { userId: "user-1", userEmail: "seller@example.com", ipHash: "hash" },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "REVEAL_MONITORING_IDENTITY",
      entityId: EVENT_ID,
    }));
  });

  it("rejects a non-admin retry and resets a failed delivery for an admin", async () => {
    const { retryMonitoringAlertDelivery } = await import("@/actions/admin/monitoring");
    requireRoleMock.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(retryMonitoringAlertDelivery(DELIVERY_ID)).rejects.toThrow("Forbidden");

    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    mockDb.monitoringAlertDelivery.findUnique.mockResolvedValue({
      id: DELIVERY_ID,
      issueId: ISSUE_ID,
      status: "FAILED",
    });
    mockDb.monitoringAlertDelivery.update.mockResolvedValue({});
    const result = await retryMonitoringAlertDelivery(DELIVERY_ID);

    expect(mockDb.monitoringAlertDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING", attempts: 0 }),
    }));
    expect(processOutboxMock).toHaveBeenCalledWith({ deliveryId: DELIVERY_ID, limit: 1 });
    expect(result).toEqual({ data: { processed: 1, sent: 1, failed: 0 } });
  });
});
