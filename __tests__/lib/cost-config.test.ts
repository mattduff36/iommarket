import { afterEach, describe, expect, it } from "vitest";
import {
  assertLedgerConfigMatchesEnvironment,
  COST_LEDGER_STARTED_AT_ISO,
  CostConfigError,
  getCostLedgerStartedAt,
  getVercelBillingConfig,
  parseCostLedgerStartedAt,
} from "@/lib/costs/config";
import {
  assertPreviewCostLedgerReady,
  costDatabaseIdentity,
  resolveCostLedgerConnection,
} from "@/lib/costs/db";
import { resolveLedgerAccess } from "@/lib/costs/ledger-access";
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

  it("uses the app database for the canonical writer and refuses a direct ledger URL", () => {
    expect(
      resolveCostLedgerConnection({
        COST_LEDGER_ROLE: "canonical",
        NODE_ENV: "production",
      }),
    ).toEqual({ mode: "app" });
    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "production",
        COST_LEDGER_ROLE: "canonical",
        COST_LEDGER_DATABASE_URL: "postgres://user:pass@prod.example:5432/postgres",
      }),
    ).toThrow(/not allowed/);
  });

  it("routes local development through the canonical API unless explicitly made the writer", () => {
    expect(
      resolveLedgerAccess({
        COST_LEDGER_ROLE: "reader",
        COST_LEDGER_ORIGIN: "https://itrader.im",
      }),
    ).toEqual({ mode: "remote", origin: "https://itrader.im" });
    expect(resolveLedgerAccess({ COST_LEDGER_ROLE: "reader" })).toMatchObject({
      mode: "unavailable",
    });
  });

  it("refuses preview direct access even when that deployment's Vercel environment is production", () => {
    const previewDatabase = "postgres://user:pass@preview.example:5432/postgres";

    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: "prj_staging",
        COST_LEDGER_ROLE: "canonical",
        COST_CANONICAL_VERCEL_PROJECT_ID: "prj_live",
        DATABASE_URL: previewDatabase,
      }),
    ).toThrow(/not the canonical ledger/);

    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_ID: "prj_preview",
        COST_LEDGER_ROLE: "canonical",
        COST_CANONICAL_VERCEL_PROJECT_ID: "prj_preview",
        COST_LEDGER_ORIGIN: "https://itrader.im",
        DATABASE_URL: previewDatabase,
        COST_LEDGER_DATABASE_URL: "postgres://user:secret@prod.example:5432/postgres",
      }),
    ).toThrow(/not allowed/);

    expect(() =>
      resolveCostLedgerConnection({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: "prj_staging",
        COST_LEDGER_ORIGIN: "https://itrader.im",
        DATABASE_URL: previewDatabase,
      }),
    ).toThrow(/canonical ledger API/);
  });

  it("identifies shared pooler databases by username, host and database", () => {
    expect(
      costDatabaseIdentity("postgres://project_a:first@pool.example:5432/postgres"),
    ).toBe(
      costDatabaseIdentity("postgres://project_a:second@pool.example:6543/postgres"),
    );
    expect(
      costDatabaseIdentity("postgres://project_a:first@pool.example:5432/postgres"),
    ).not.toBe(
      costDatabaseIdentity("postgres://project_b:first@pool.example:5432/postgres"),
    );
  });

  it("fails closed when a hosted non-canonical deployment reads the local ledger", () => {
    const env = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_staging",
      COST_LEDGER_STARTED_AT: COST_LEDGER_STARTED_AT_ISO,
    } as unknown as NodeJS.ProcessEnv;

    expect(() => assertPreviewCostLedgerReady(null, env)).toThrow(
      /canonical ledger/,
    );
    expect(() =>
      assertPreviewCostLedgerReady(
        {
          startedAt: new Date(COST_LEDGER_STARTED_AT_ISO),
          policyVersion: "wrong-policy",
        },
        env,
      ),
    ).toThrow(CostConfigError);
    expect(() =>
      assertPreviewCostLedgerReady(
        {
          startedAt: new Date(COST_LEDGER_STARTED_AT_ISO),
          policyVersion: COST_POLICY_VERSION,
        },
        {
          COST_LEDGER_ROLE: "canonical",
          COST_LEDGER_STARTED_AT: COST_LEDGER_STARTED_AT_ISO,
        },
      ),
    ).not.toThrow();
  });
});
