import { afterEach, describe, expect, it } from "vitest";
import {
  assertLedgerConfigMatchesEnvironment,
  COST_LEDGER_STARTED_AT_ISO,
  CostConfigError,
  getCostLedgerStartedAt,
  isProductionRuntime,
  parseCostLedgerStartedAt,
} from "@/lib/costs/config";
import { COST_POLICY_VERSION } from "@/lib/costs/money";

describe("cost ledger configuration T1", () => {
  const previousStartedAt = process.env.COST_LEDGER_STARTED_AT;

  afterEach(() => {
    if (previousStartedAt === undefined) {
      delete process.env.COST_LEDGER_STARTED_AT;
    } else {
      process.env.COST_LEDGER_STARTED_AT = previousStartedAt;
    }
  });

  it("parses the exact Isle of Man midnight boundary", () => {
    const startedAt = parseCostLedgerStartedAt(COST_LEDGER_STARTED_AT_ISO);
    expect(startedAt.toISOString()).toBe("2026-08-13T23:00:00.000Z");
    expect(startedAt.getTime()).toBe(Date.parse("2026-08-13T23:00:00.000Z"));
  });

  it("rejects a timezone-less timestamp", () => {
    expect(() => parseCostLedgerStartedAt("2026-08-14T00:00:00")).toThrow(
      CostConfigError,
    );
  });

  it("rejects offset timestamps and impossible calendar dates", () => {
    expect(() => parseCostLedgerStartedAt("2026-08-13T23:00:00+00:00")).toThrow(
      CostConfigError,
    );
    expect(() => parseCostLedgerStartedAt("2026-02-30T00:00:00.000Z")).toThrow(
      CostConfigError,
    );
  });

  it("reads the environment contract and rejects boundary or policy drift", () => {
    process.env.COST_LEDGER_STARTED_AT = COST_LEDGER_STARTED_AT_ISO;
    expect(getCostLedgerStartedAt().toISOString()).toBe(COST_LEDGER_STARTED_AT_ISO);

    expect(() =>
      assertLedgerConfigMatchesEnvironment({
        startedAt: new Date("2026-09-01T07:00:00.000Z"),
        policyVersion: COST_POLICY_VERSION,
      }),
    ).toThrow(CostConfigError);

    expect(() =>
      assertLedgerConfigMatchesEnvironment({
        startedAt: new Date(COST_LEDGER_STARTED_AT_ISO),
        policyVersion: "other-policy",
      }),
    ).toThrow(CostConfigError);

    expect(() =>
      assertLedgerConfigMatchesEnvironment({
        startedAt: new Date(COST_LEDGER_STARTED_AT_ISO),
        policyVersion: COST_POLICY_VERSION,
      }),
    ).not.toThrow();
  });

  it("treats Vercel preview runtimes as non-production", () => {
    expect(
      isProductionRuntime({
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isProductionRuntime({
        VERCEL_ENV: "production",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
  });
});
