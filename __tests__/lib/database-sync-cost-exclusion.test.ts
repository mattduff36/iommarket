import { describe, expect, it } from "vitest";
import { loadCloneCatalog } from "@/lib/database-sync/catalog";
import { schemaCompatibility } from "@/lib/database-sync/fingerprint";
import {
  DATABASE_SYNC_SCOPE,
  EXCLUDED_SYNC_TABLES,
  SYNC_SCOPE_DESCRIPTION,
  excludedSyncTable,
} from "@/lib/database-sync/scope-policy";

const COST_LEDGER_TABLES = [
  "CostLedgerConfig",
  "FxRateSnapshot",
  "CostSourceSnapshot",
  "CostEntry",
  "CostSyncLock",
  "CostSyncRun",
  "InvoiceRequest",
  "InvoiceRequestLine",
  "CostSettlement",
  "CostWorkflowEvent",
  "CostEmailOutbox",
  "CostUsageEvent",
  "CostIngestBatch",
  "CostAllowanceObservation",
  "CostClientPolicy",
] as const;

describe("database merge cost ledger exclusion", () => {
  it("omits append-only cost ledger tables from the clone catalog", () => {
    const catalog = loadCloneCatalog();
    expect(DATABASE_SYNC_SCOPE).toBe("marketplace-exclusions-v2");
    expect(SYNC_SCOPE_DESCRIPTION).toContain("project cost ledger");
    for (const table of COST_LEDGER_TABLES) {
      expect(EXCLUDED_SYNC_TABLES).toContain(table);
      expect(excludedSyncTable(table)).toBe(true);
      expect(catalog.some((entry) => entry.name === table)).toBe(false);
    }
    for (const table of ["User", "Listing", "Payment", "Subscription", "SiteSetting"]) {
      expect(excludedSyncTable(table)).toBe(false);
      expect(catalog.some((entry) => entry.name === table)).toBe(true);
    }
  });

  it("does not treat a cost-ledger schema difference as a merge blocker", () => {
    const result = schemaCompatibility(
      [
        "column|public|User|id|text|true|-1|",
        "column|public|CostEntry|nativeAmount|numeric(20,8)|true|-1|",
        "constraint|public|CostEntry|CostEntry_pkey|p|PRIMARY KEY (id)|false|false",
        "enum|public|CostEntryKind|CHARGE|1",
      ],
      ["column|public|User|id|text|true|-1|"],
    );
    expect(result).toEqual({ schemaCompatible: true, migrationsCompatible: true, blockers: [] });
  });
});
