/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CostConfigError } from "@/lib/costs/config";

const { assertCanonicalLedgerWriter, runCostSync } = vi.hoisted(() => ({
  assertCanonicalLedgerWriter: vi.fn(),
  runCostSync: vi.fn(),
}));

vi.mock("@/lib/costs/ledger-role", () => ({
  assertCanonicalLedgerWriter,
}));

vi.mock("@/lib/costs/sync", () => ({
  runCostSync,
}));

const originalEnv = {
  enabled: process.env.COSTS_ENABLED,
  request: process.env.COST_LEDGER_REQUEST_SECRET,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("canonical cost ledger refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_REQUEST_SECRET = "request-secret";
  });

  afterEach(() => {
    restore("COSTS_ENABLED", originalEnv.enabled);
    restore("COST_LEDGER_REQUEST_SECRET", originalEnv.request);
  });

  it("rejects a missing credential and a non-canonical caller", async () => {
    const { POST } = await import("@/app/api/internal/cost-ledger/refresh/route");
    const denied = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(denied.status).toBe(401);

    assertCanonicalLedgerWriter.mockImplementation(() => {
      throw new CostConfigError("This deployment is not the canonical ledger writer.");
    });
    const forbidden = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
        body: "{}",
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(runCostSync).not.toHaveBeenCalled();
  });

  it("runs the provider refresh and reports an existing lock without failing", async () => {
    assertCanonicalLedgerWriter.mockImplementation(() => undefined);
    runCostSync.mockResolvedValueOnce({ status: "succeeded" });
    const { POST } = await import("@/app/api/internal/cost-ledger/refresh/route");
    const refreshed = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
        body: "{}",
      }),
    );
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      data: { status: "succeeded" },
    });
    expect(runCostSync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "MANUAL" }),
    );

    runCostSync.mockResolvedValueOnce({ status: "locked" });
    const locked = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
        body: "{}",
      }),
    );
    expect(locked.status).toBe(200);
    await expect(locked.json()).resolves.toMatchObject({
      data: { status: "locked" },
    });

    runCostSync.mockResolvedValueOnce({
      status: "partial",
      caughtUp: false,
      errorCode: "COST_SYNC_CONTINUE",
    });
    const partial = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
        body: "{}",
      }),
    );
    expect(partial.status).toBe(200);
    await expect(partial.json()).resolves.toMatchObject({
      data: {
        status: "partial",
        caughtUp: false,
        errorCode: "COST_SYNC_CONTINUE",
      },
    });
  });

  it("returns a failure status when the provider refresh fails", async () => {
    assertCanonicalLedgerWriter.mockImplementation(() => undefined);
    runCostSync.mockResolvedValue({ status: "failed" });
    const { POST } = await import("@/app/api/internal/cost-ledger/refresh/route");
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/refresh", {
        method: "POST",
        headers: { authorization: "Bearer request-secret" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "failed" },
    });
  });
});
