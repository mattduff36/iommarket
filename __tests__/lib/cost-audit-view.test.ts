import { describe, expect, it } from "vitest";
import { buildCostAuditView } from "@/lib/costs/audit-view";
import { buildCostUsageModel } from "@/lib/costs/usage-view";
import type { CostLineDto } from "@/lib/costs/dto";

function line(id: string, amountMinor: number, day: string, category: CostLineDto["category"] = "CURSOR"): CostLineDto {
  return { id, amountMinor, amountLabel: "", section: "Manual credit", category, label: id,
    kind: amountMinor < 0 ? "REVERSAL" : "CHARGE", invoiceability: "INVOICEABLE",
    periodStart: `${day}T00:00:00Z`, periodEnd: `${day}T23:59:59Z`, provisional: false };
}

describe("audit report balances", () => {
  it("nets revisions before composition and ranking, retaining negative manual categories", () => {
    const model = buildCostUsageModel({ range: "all", lines: [
      line("original", 1000, "2026-09-01"), line("reverse", -1000, "2026-09-01"),
      line("replacement", 600, "2026-09-01"), line("later", 200, "2026-09-02"),
      line("credit", -300, "2026-09-02", "OTHER"),
    ] });
    const audit = buildCostAuditView(model);
    expect(audit.netTotal).toBe(500);
    expect(audit.positiveTotal).toBe(800);
    expect(audit.negativeCategories[0]?.amountMinor).toBe(-300);
    expect(audit.rankedDays.map(day => day.total)).toEqual([600]);
    expect(audit.daily.map(day => day.total)).toEqual([600, -100]);
  });
  it("uses only the selected period and preserves empty states", () => {
    const model = buildCostUsageModel({ range: "7d", now: new Date("2026-10-03T12:00:00Z"),
      lines: [line("old", 999, "2026-09-01")] });
    const audit = buildCostAuditView(model);
    expect(audit.netTotal).toBe(0);
    expect(audit.composition).toEqual([]);
    expect(audit.rankedDays).toEqual([]);
  });
});
