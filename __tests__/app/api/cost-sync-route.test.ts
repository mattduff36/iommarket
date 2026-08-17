/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runCostSync = vi.fn();

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
}));

describe("internal cost sync route", () => {
  const previous = {
    secret: process.env.COST_SYNC_SECRET,
    enabled: process.env.COSTS_ENABLED,
    allow: process.env.COST_SYNC_ALLOW_NON_PROD,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COST_SYNC_SECRET = "sync-secret";
    process.env.COSTS_ENABLED = "true";
    process.env.COST_SYNC_ALLOW_NON_PROD = "1";
    runCostSync.mockResolvedValue({ status: "succeeded", runId: "run_1" });
  });

  afterEach(() => {
    process.env.COST_SYNC_SECRET = previous.secret;
    process.env.COSTS_ENABLED = previous.enabled;
    process.env.COST_SYNC_ALLOW_NON_PROD = previous.allow;
    process.env.VERCEL_ENV = previous.vercelEnv;
    process.env.NODE_ENV = previous.nodeEnv;
  });

  it("rejects unauthorized POSTs", async () => {
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        body: JSON.stringify({ eventId: "dpl_1", target: "production" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("synchronizes an authorized production deployment event", async () => {
    const { POST } = await import("@/app/api/internal/cost-sync/route");
    const response = await POST(
      new NextRequest("http://localhost:4000/api/internal/cost-sync", {
        method: "POST",
        headers: {
          authorization: "Bearer sync-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId: "dpl_1",
          target: "production",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "succeeded", runId: "run_1" },
    });
  });
});
