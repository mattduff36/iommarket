/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runCostSync = vi.fn();
const retryPendingCostEmails = vi.fn();

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
}));

vi.mock("@/lib/costs/email", () => ({
  retryPendingCostEmails,
}));

describe("cost maintenance cron", () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousEnabled = process.env.COSTS_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.COSTS_ENABLED = "true";
    runCostSync.mockResolvedValue({ status: "succeeded" });
    retryPendingCostEmails.mockResolvedValue(1);
  });

  afterEach(() => {
    process.env.CRON_SECRET = previousSecret;
    process.env.COSTS_ENABLED = previousEnabled;
  });

  it("rejects requests without the cron bearer token", async () => {
    const { GET } = await import("@/app/api/cron/cost-maintenance/route");
    const response = await GET(new NextRequest("http://localhost:4000/api/cron/cost-maintenance"));
    expect(response.status).toBe(401);
  });

  it("reconciles billing and retries outbox rows when authorized", async () => {
    const { GET } = await import("@/app/api/cron/cost-maintenance/route");
    const response = await GET(
      new NextRequest("http://localhost:4000/api/cron/cost-maintenance", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { sync: { status: "succeeded" }, emails: 1 },
    });
  });
});
