import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COST_LEDGER_PREVIOUS_STARTED_AT_NAIVE,
  COST_LEDGER_STARTED_AT_ISO,
} from "@/lib/costs/config";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260817120000_cost_ledger_started_at_timestamptz/migration.sql",
  ),
  "utf8",
);

describe("cost ledger startedAt migration T2", () => {
  it("locks cost tables and aborts on active sync or existing financial rows", () => {
    expect(migration.startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(migration).toContain("IN ACCESS EXCLUSIVE MODE");
    for (const table of [
      "CostLedgerConfig",
      "CostSyncLock",
      "CostSyncRun",
      "CostSourceSnapshot",
      "FxRateSnapshot",
      "CostEntry",
      "InvoiceRequest",
      "InvoiceRequestLine",
      "CostSettlement",
      "CostWorkflowEvent",
      "CostEmailOutbox",
    ]) {
      expect(migration).toContain(`"${table}"`);
    }
    expect(migration).toContain("active sync lock");
    expect(migration).toContain("financial or provenance rows exist");
    expect(migration).toContain("expected exactly one config row");
    expect(migration).toContain(`TIMESTAMP '${COST_LEDGER_PREVIOUS_STARTED_AT_NAIVE}'`);
    expect(migration).toContain("gbp-markup-v1");
    expect(migration).toContain("immutability trigger is missing or disabled");
  });

  it("converts only the default row and restores the immutability trigger", () => {
    expect(migration).toContain(
      'DROP TRIGGER cost_ledger_config_immutable ON "CostLedgerConfig"',
    );
    expect(migration).not.toContain("DROP TRIGGER IF EXISTS");
    expect(migration).toContain('ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3)');
    expect(migration).toContain(`USING "startedAt" AT TIME ZONE 'Europe/London'`);
    expect(migration).toContain("WHERE id = 'default'");
    expect(migration).toContain("GET DIAGNOSTICS updated_count = ROW_COUNT");
    expect(migration).toContain("expected to update exactly one config row");
    expect(migration).toContain(
      "CREATE TRIGGER cost_ledger_config_immutable",
    );
    expect(migration).toContain("EXECUTE FUNCTION public.cost_forbid_mutation()");
    expect(migration).toContain("TIMESTAMPTZ '2026-08-13 23:00:00+00'");
    expect(migration).toContain("startedAt did not round-trip");
    expect(migration).toContain("timestamp(3) with time zone");
    expect(migration).toContain("immutability trigger was not restored");
    expect(COST_LEDGER_STARTED_AT_ISO).toBe("2026-08-13T23:00:00.000Z");
  });
});
