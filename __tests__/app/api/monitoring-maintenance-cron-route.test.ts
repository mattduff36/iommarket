/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runMonitoringMaintenance = vi.fn();

vi.mock("@/lib/monitoring/maintenance", () => ({
  runMonitoringMaintenance,
}));

describe("monitoring maintenance cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    runMonitoringMaintenance.mockResolvedValue({
      unmuted: 0,
      outbox: { processed: 0, sent: 0, failed: 0 },
      digest: { sent: false, events: 0 },
      canary: { status: "skipped" },
      retention: null,
      vercelFallback: "configured",
    });
  });

  it("rejects requests without the cron bearer token", async () => {
    const { GET } = await import("@/app/api/cron/monitoring-maintenance/route");
    const response = await GET(new NextRequest("http://localhost:4000/api/cron/monitoring-maintenance"));
    expect(response.status).toBe(401);
    expect(runMonitoringMaintenance).not.toHaveBeenCalled();
  });

  it("runs the maintenance pipeline when authorized", async () => {
    const { GET } = await import("@/app/api/cron/monitoring-maintenance/route");
    const response = await GET(
      new NextRequest("http://localhost:4000/api/cron/monitoring-maintenance", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(runMonitoringMaintenance).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ vercelFallback: "configured" }),
    });
  });
});
