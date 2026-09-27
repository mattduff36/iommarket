/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { assertCanonicalLedgerWriter, recordManualLedgerCost, workflowCreate } = vi.hoisted(() => ({
  assertCanonicalLedgerWriter: vi.fn(),
  recordManualLedgerCost: vi.fn(),
  workflowCreate: vi.fn(),
}));

vi.mock("@/lib/costs/ledger-role", () => ({
  assertCanonicalLedgerWriter,
}));

vi.mock("@/lib/costs/manual-entry", () => ({
  recordManualLedgerCost,
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {
    costWorkflowEvent: { create: workflowCreate },
  },
}));

const originalEnv = {
  enabled: process.env.COSTS_ENABLED,
  request: process.env.COST_LEDGER_REQUEST_SECRET,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const manualCost = {
  category: "OTHER",
  externalRef: "exclude-costs-page",
  nativeAmount: "-12.50",
  nativeCurrency: "GBP",
  displayLabel: "Exclude costs page work",
  periodStart: "2026-08-17T00:00:00.000Z",
  periodEnd: "2026-09-27T00:00:00.000Z",
};

describe("canonical manual cost API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COSTS_ENABLED = "true";
    process.env.COST_LEDGER_REQUEST_SECRET = "request-secret";
    recordManualLedgerCost.mockResolvedValue(undefined);
    workflowCreate.mockResolvedValue({ id: "event-1" });
  });

  afterEach(() => {
    restore("COSTS_ENABLED", originalEnv.enabled);
    restore("COST_LEDGER_REQUEST_SECRET", originalEnv.request);
  });

  it("records a signed manual cost for an authorized canonical writer", async () => {
    const { POST } = await import("@/app/api/internal/cost-ledger/manual/route");
    const response = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual", {
        method: "POST",
        headers: {
          authorization: "Bearer request-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(manualCost),
      }),
    );

    expect(response.status).toBe(200);
    expect(recordManualLedgerCost).toHaveBeenCalledWith(manualCost);
    expect(workflowCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "PREVIEW_MANUAL_COST",
        payload: {
          origin: "preview",
          category: "OTHER",
          externalRef: "exclude-costs-page",
        },
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { recorded: true, affectsLiveLedger: true },
    });
  });

  it("rejects a missing request secret and an invalid amount", async () => {
    const { POST } = await import("@/app/api/internal/cost-ledger/manual/route");
    const denied = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manualCost),
      }),
    );
    expect(denied.status).toBe(401);
    expect(recordManualLedgerCost).not.toHaveBeenCalled();

    const invalid = await POST(
      new NextRequest("https://itrader.im/api/internal/cost-ledger/manual", {
        method: "POST",
        headers: {
          authorization: "Bearer request-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...manualCost, nativeAmount: "0" }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(recordManualLedgerCost).not.toHaveBeenCalled();
  });
});
