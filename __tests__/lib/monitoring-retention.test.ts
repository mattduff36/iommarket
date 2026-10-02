import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();
const deliveryDeleteMany = vi.fn();
const eventDeleteMany = vi.fn();
const issueDeleteMany = vi.fn();
const upsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    monitoringIssue: { updateMany, deleteMany: issueDeleteMany },
    monitoringAlertDelivery: { deleteMany: deliveryDeleteMany },
    monitoringEvent: { deleteMany: eventDeleteMany },
    monitoringPipelineHealth: { upsert },
  },
}));

describe("monitoring retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 2 });
    deliveryDeleteMany.mockResolvedValue({ count: 3 });
    eventDeleteMany.mockResolvedValue({ count: 4 });
    issueDeleteMany.mockResolvedValue({ count: 1 });
    upsert.mockResolvedValue({});
  });

  it("keeps detailed rows for 90 days and resolved issues for 12 months", async () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    const { compactMonitoringHistory } = await import("@/lib/monitoring/retention");
    const result = await compactMonitoringHistory(now);

    expect(result).toEqual({
      clearedPrompts: 2,
      deletedDeliveries: 3,
      deletedEvents: 4,
      deletedIssues: 1,
    });
    expect(eventDeleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date("2026-07-04T00:00:00.000Z") } },
    });
    expect(issueDeleteMany).toHaveBeenCalledWith({
      where: {
        status: "RESOLVED",
        resolvedAt: { lt: new Date("2025-10-02T00:00:00.000Z") },
        lastSeenAt: { lt: new Date("2025-10-02T00:00:00.000Z") },
      },
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "singleton" },
    }));
  });
});
