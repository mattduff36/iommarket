/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runCostSync = vi.fn();
const retryPendingCostEmails = vi.fn();
const readAccountsReaderSync = vi.fn();

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
}));

vi.mock("@/lib/costs/email", () => ({
  retryPendingCostEmails,
}));

vi.mock("@/lib/costs/accounts-health", () => ({
  readAccountsReaderSync,
  closedAccountsReaderSync: (
    sync: { status: "succeeded" | "failed"; source: "accounts" } | null,
  ) => sync ?? { status: "failed" as const, source: "accounts" as const },
}));

describe("cost maintenance cron", () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousEnabled = process.env.COSTS_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_ROLE = "canonical";
    delete process.env.VERCEL_PROJECT_ID;
    runCostSync.mockResolvedValue({ status: "succeeded" });
    retryPendingCostEmails.mockResolvedValue(1);
    readAccountsReaderSync.mockResolvedValue({
      status: "succeeded",
      source: "accounts",
      asOf: "2026-10-21T09:00:00.000Z",
      sourceUpdatedAt: null,
    });
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
    expect(readAccountsReaderSync).not.toHaveBeenCalled();
    expect(retryPendingCostEmails).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      data: { sync: { status: "succeeded" }, emails: 1 },
    });
  });

  it("returns 502 when sync fails", async () => {
    runCostSync.mockResolvedValue({ status: "failed" });
    const { GET } = await import("@/app/api/cron/cost-maintenance/route");
    const response = await GET(
      new NextRequest("http://localhost:4000/api/cron/cost-maintenance", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(502);
    expect(retryPendingCostEmails).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      data: { sync: { status: "failed" }, emails: 1 },
    });
  });

  it("returns 409 when sync is locked", async () => {
    runCostSync.mockResolvedValue({ status: "locked" });
    const { GET } = await import("@/app/api/cron/cost-maintenance/route");
    const response = await GET(
      new NextRequest("http://localhost:4000/api/cron/cost-maintenance", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(409);
    expect(retryPendingCostEmails).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      data: { sync: { status: "locked" }, emails: 1 },
    });
  });

  it("keeps accounts-preview off the reader path", async () => {
    process.env.COST_LEDGER_ROLE = "accounts-preview";
    const { GET } = await import("@/app/api/cron/cost-maintenance/route");
    const response = await GET(authorizedCronRequest());
    expect(response.status).toBe(403);
    expect(readAccountsReaderSync).not.toHaveBeenCalled();
    expect(runCostSync).not.toHaveBeenCalled();
    expect(retryPendingCostEmails).not.toHaveBeenCalled();
  });

  describe("accounts-reader", () => {
    beforeEach(() => {
      process.env.COST_LEDGER_ROLE = "accounts-reader";
    });

    it("rejects unauthorized requests before reading Accounts", async () => {
      const { GET } = await import("@/app/api/cron/cost-maintenance/route");
      const response = await GET(new NextRequest("http://localhost:4000/api/cron/cost-maintenance"));
      expect(response.status).toBe(401);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
      expect(retryPendingCostEmails).not.toHaveBeenCalled();
    });

    it("skips when costs are disabled", async () => {
      process.env.COSTS_ENABLED = "false";
      const { GET } = await import("@/app/api/cron/cost-maintenance/route");
      const response = await GET(authorizedCronRequest());
      expect(response.status).toBe(200);
      expect(readAccountsReaderSync).not.toHaveBeenCalled();
      expect(runCostSync).not.toHaveBeenCalled();
      expect(retryPendingCostEmails).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({ data: { status: "skipped" } });
    });

    it("returns a sync result and zero email activity when Accounts is readable", async () => {
      const { GET } = await import("@/app/api/cron/cost-maintenance/route");
      const response = await GET(authorizedCronRequest());
      expect(response.status).toBe(200);
      expect(readAccountsReaderSync).toHaveBeenCalledTimes(1);
      expect(runCostSync).not.toHaveBeenCalled();
      expect(retryPendingCostEmails).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        data: {
          sync: {
            status: "succeeded",
            source: "accounts",
            asOf: "2026-10-21T09:00:00.000Z",
            sourceUpdatedAt: null,
          },
          emails: 0,
        },
      });
    });

    it("fails closed without email retries when Accounts is unavailable", async () => {
      readAccountsReaderSync.mockResolvedValue({ status: "failed", source: "accounts" });
      const { GET } = await import("@/app/api/cron/cost-maintenance/route");
      const response = await GET(authorizedCronRequest());
      expect(response.status).toBe(502);
      expect(runCostSync).not.toHaveBeenCalled();
      expect(retryPendingCostEmails).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        data: { sync: { status: "failed", source: "accounts" }, emails: 0 },
      });
    });
  });
});

function authorizedCronRequest(): NextRequest {
  return new NextRequest("http://localhost:4000/api/cron/cost-maintenance", {
    headers: { authorization: "Bearer cron-secret" },
  });
}
