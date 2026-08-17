import { describe, expect, it } from "vitest";
import {
  COST_CALCULATION_HELP,
  interpretManualCostSyncResult,
  manualCostSyncMessage,
} from "@/lib/costs/copy";

describe("manual cost sync messages T4", () => {
  it("uses distinct actionable copy for each sync outcome", () => {
    expect(manualCostSyncMessage({ status: "succeeded" })).toMatch(/refreshed/i);
    expect(manualCostSyncMessage({ status: "failed" })).toMatch(/failed/i);
    expect(manualCostSyncMessage({ status: "locked" })).toMatch(/already running/i);
    expect(manualCostSyncMessage({ status: "skipped" })).toMatch(/skipped/i);
  });

  it("treats only a succeeded result as success", () => {
    expect(
      interpretManualCostSyncResult({
        data: { status: "succeeded", message: "Provider costs were refreshed." },
      }),
    ).toEqual({ ok: true, message: "Provider costs were refreshed." });
    expect(
      interpretManualCostSyncResult({
        error: "A cost refresh is already running. Try again in a few minutes.",
        data: { status: "locked" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      interpretManualCostSyncResult({
        error: "Provider cost refresh failed. Check the sync card for the latest status.",
        data: { status: "failed" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      interpretManualCostSyncResult({
        error: "Cost refresh was skipped because tracking is disabled or the ledger start date is still in the future.",
        data: { status: "skipped" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("describes the actual business-day FX policy", () => {
    expect(COST_CALCULATION_HELP).toMatch(/business-day/i);
    expect(COST_CALCULATION_HELP).toMatch(/Friday/i);
    expect(COST_CALCULATION_HELP).not.toMatch(/previous weekday/i);
    expect(COST_CALCULATION_HELP).not.toMatch(/markup|20%/i);
  });
});
