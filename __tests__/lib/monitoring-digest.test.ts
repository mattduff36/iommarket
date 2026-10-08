import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: vi.fn(), health: vi.fn(), upsert: vi.fn(), enqueue: vi.fn(), process: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  monitoringEvent: { findMany: mocks.events },
  monitoringPipelineHealth: { findUnique: mocks.health, upsert: mocks.upsert },
} }));
vi.mock("@/lib/config/monitoring", () => ({
  getMonitoringAlertMinSeverityAsync: async () => "HIGH",
  getMonitoringAlertEmailRecipientsAsync: async () => ["admin@example.com"],
  getMonitoringAlertWebhookUrlAsync: async () => "",
}));
vi.mock("@/lib/monitoring/alert-outbox", () => ({
  enqueueMonitoringAlert: mocks.enqueue, processMonitoringAlertOutbox: mocks.process,
}));
import { sendMonitoringDigest } from "@/lib/monitoring/digest";

const event = (id: string) => ({
  severity: "LOW", message: "A smaller problem", environment: "production", route: "/search",
  issue: { id, title: "Search problem", occurrences: 25, sampleRoute: "/search", sampleAction: "search" },
});

describe("monitoring digest", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.health.mockResolvedValue(null); });

  it("lists each issue once and distinguishes event and issue counts", async () => {
    mocks.events.mockResolvedValue([event("first"), event("first"), event("second")]);
    await sendMonitoringDigest(new Date("2026-10-08T00:15:00Z"));
    const payload = mocks.enqueue.mock.calls[0][0].payload;
    expect(payload.text.match(/\/admin\/monitoring\/first/g)).toHaveLength(1);
    expect(payload.text).toContain("2 distinct smaller issues");
    expect(payload.webhookBody).toMatchObject({ eventCount: 3, issueCount: 2 });
  });

  it("queries active issues only and excludes routine canary events", async () => {
    mocks.events.mockResolvedValue([]);
    await sendMonitoringDigest(new Date("2026-10-08T00:15:00Z"));
    expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      issue: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      message: { not: "monitoring-canary" },
    }) }));
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
