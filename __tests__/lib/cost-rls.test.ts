import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("COST-RLS-001 private cost tables", () => {
  it("enables RLS without adding PostgREST policies", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "prisma", "migrations", "20260817010000_project_cost_ledger", "migration.sql"),
      "utf8",
    );

    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toContain("EXECUTE FUNCTION public.cost_forbid_mutation()");
    expect(sql).toContain('ALTER TABLE "public"."CostEntry" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "public"."InvoiceRequest" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "public"."CostSettlement" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "public"."CostSyncLock" ENABLE ROW LEVEL SECURITY');
  });
});
