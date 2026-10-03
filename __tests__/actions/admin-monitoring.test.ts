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
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    monitoringPipelineHealth: {
      upsert: vi.fn(),
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
    mockDb.monitoringAlertDelivery.updateMany.mockResolvedValue({ count: 1 });
    const result = await retryMonitoringAlertDelivery(DELIVERY_ID);

    expect(mockDb.monitoringAlertDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: DELIVERY_ID, status: "FAILED" },
      data: expect.objectContaining({ status: "PENDING", attempts: 0 }),
    }));
    expect(processOutboxMock).toHaveBeenCalledWith({ deliveryId: DELIVERY_ID, limit: 1 });
    expect(result).toEqual({ data: { processed: 1, sent: 1, failed: 0 } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/monitoring");
  });

  it("does not retry a delivery that another worker already claimed", async () => {
    mockDb.monitoringAlertDelivery.findUnique.mockResolvedValue({
      id: DELIVERY_ID,
      issueId: ISSUE_ID,
      status: "FAILED",
    });
    mockDb.monitoringAlertDelivery.updateMany.mockResolvedValue({ count: 0 });
    const { retryMonitoringAlertDelivery } = await import("@/actions/admin/monitoring");

    await expect(retryMonitoringAlertDelivery(DELIVERY_ID)).resolves.toEqual({
      error: "Delivery is no longer available to retry",
    });
    expect(processOutboxMock).not.toHaveBeenCalled();
  });

  it("retries unresolved failed alerts and can clear the pipeline warning", async () => {
    mockDb.monitoringAlertDelivery.findMany.mockResolvedValue([{ id: DELIVERY_ID }]);
    mockDb.monitoringAlertDelivery.findUnique.mockResolvedValue({
      id: DELIVERY_ID,
      issueId: ISSUE_ID,
      status: "FAILED",
    });
    mockDb.monitoringAlertDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mockDb.monitoringPipelineHealth.upsert.mockResolvedValue({ id: "singleton" });
    const { retryFailedMonitoringAlerts, clearMonitoringPipelineWarning } = await import("@/actions/admin/monitoring");

    await expect(retryFailedMonitoringAlerts()).resolves.toEqual({
      data: { attempted: 1, sent: 1, failed: 0 },
    });
    await expect(clearMonitoringPipelineWarning({ deliveryIds: [DELIVERY_ID] })).resolves.toEqual({
      data: { cleared: 1 },
    });
    expect(mockDb.monitoringAlertDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: { in: [DELIVERY_ID] }, status: "FAILED" },
      data: expect.objectContaining({ status: "SKIPPED" }),
    }));
    expect(mockDb.monitoringAlertDelivery.updateMany.mock.calls.at(-1)?.[0]?.data).not.toHaveProperty("lastError");
    expect(mockDb.monitoringPipelineHealth.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        consecutiveAlertFailures: 0,
        consecutiveCaptureFailures: 0,
      }),
    }));
    expect(logAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "CLEAR_MONITORING_PIPELINE_WARNING",
    }), mockDb);
  });
});
