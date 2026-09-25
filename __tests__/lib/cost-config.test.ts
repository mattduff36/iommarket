import { afterEach, describe, expect, it } from "vitest";
import {
  assertLedgerConfigMatchesEnvironment,
  COST_LEDGER_STARTED_AT_ISO,
  CostConfigError,
  getCostLedgerStartedAt,
  getVercelBillingConfig,
  isProductionRuntime,
  parseCostLedgerStartedAt,
} from "@/lib/costs/config";
import { resolveCostLedgerConnection } from "@/lib/costs/db";
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

describe("cost ledger connection", () => {
  const billingEnv = {
    VERCEL_BILLING_TOKEN: "token",
    COST_VERCEL_TEAM_ID: "team_1",
    COST_VERCEL_PROJECT_ID: "prj_1",
    COST_VERCEL_DATABASE_RESOURCE_ID: "store_prod",
    COST_VERCEL_PREVIEW_DATABASE_RESOURCE_ID: "store_preview",
  } as unknown as NodeJS.ProcessEnv;

  it("classifies both database stores for this project", () => {
    expect(getVercelBillingConfig(billingEnv).databaseResourceIds).toEqual([
      "store_prod",
      "store_preview",
    ]);
  });

  it("keeps production database classification when the preview store is not configured", () => {
    expect(
      getVercelBillingConfig({
        ...billingEnv,
        COST_VERCEL_PREVIEW_DATABASE_RESOURCE_ID: undefined,
      }).databaseResourceIds,
    ).toEqual(["store_prod"]);
  });

  it("rejects identical production and preview database resource ids", () => {
    expect(() =>
      getVercelBillingConfig({
        ...billingEnv,
        COST_VERCEL_PREVIEW_DATABASE_RESOURCE_ID: "store_prod",
      }),
    ).toThrow(CostConfigError);
  });

  it("uses the app database outside preview", () => {
    expect(resolveCostLedgerConnection({ NODE_ENV: "production" })).toEqual({ mode: "app" });
    expect(
      resolveCostLedgerConnection({
        VERCEL_ENV: "production",
        COST_LEDGER_DATABASE_URL: "postgres://user:pass@prod.example:5432/postgres",
      }),
    ).toEqual({ mode: "app" });
  });

  it("requires a distinct production ledger URL on preview", () => {
    const previewDatabase = "postgres://user:pass@preview.example:5432/postgres";
    const productionDatabase = "postgres://user:pass@prod.example:5432/postgres";

    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "preview",
        DATABASE_URL: previewDatabase,
      }),
    ).toThrow(CostConfigError);

    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "preview",
        DATABASE_URL: previewDatabase,
        COST_LEDGER_DATABASE_URL: "postgres://other:secret@preview.example:6543/postgres",
      }),
    ).toThrow(/preview marketplace database/);

    expect(
      resolveCostLedgerConnection({
        VERCEL_ENV: "preview",
        DATABASE_URL: previewDatabase,
        POSTGRES_URL: "postgres://user:pass@preview.example:6543/postgres",
        COST_LEDGER_DATABASE_URL: productionDatabase,
      }),
    ).toEqual({ mode: "ledger", url: productionDatabase });
  });
});
