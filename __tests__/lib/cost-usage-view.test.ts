import { describe, expect, it } from "vitest";
import type { CostLineDto } from "@/lib/costs/dto";
import {
  COST_USAGE_PAGE_SIZE,
  buildCostUsageModel,
  lineSeriesKey,
  paginateCostLines,
  usageRangeBounds,
} from "@/lib/costs/usage-view";

function line(overrides: Partial<CostLineDto>): CostLineDto {
  return {
    id: overrides.id ?? "entry_1",
    section: overrides.section ?? "Development",
    category: overrides.category ?? "CURSOR",
    label: overrides.label ?? "Cursor 2026-09-26 included",
    amountLabel: overrides.amountLabel ?? "£1.00",
    amountMinor: overrides.amountMinor ?? 100,
    invoiceability: overrides.invoiceability ?? "INVOICEABLE",
    periodStart: overrides.periodStart ?? "2026-09-26T00:00:00.000Z",
    periodEnd: overrides.periodEnd ?? "2026-09-27T00:00:00.000Z",
    provisional: overrides.provisional ?? false,
  };
}

describe("cost usage view", () => {
  it("maps cursor funding labels and other sections onto chart series", () => {
    expect(lineSeriesKey(line({ label: "Cursor 2026-09-26 included" }))).toBe("Included");
    expect(lineSeriesKey(line({ label: "Cursor 2026-09-26 on-demand" }))).toBe("On-demand");
    expect(
      lineSeriesKey(
        line({
          category: "VERCEL_HOSTING",
          section: "Vercel Hosting",
          label: "Hosting",
        }),
      ),
    ).toBe("Vercel Hosting");
  });

  it("builds inclusive 7d, MTD, and last-month bounds from a fixed now", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    expect(usageRangeBounds("7d", now, [])).toEqual({
      fromDay: "2026-09-20",
      toDay: "2026-09-26",
    });
    expect(usageRangeBounds("mtd", now, [])).toEqual({
      fromDay: "2026-09-01",
      toDay: "2026-09-26",
    });
    expect(usageRangeBounds("last-month", now, [])).toEqual({
      fromDay: "2026-08-01",
      toDay: "2026-08-31",
    });
  });

  it("builds a cumulative stacked series and paginates newest lines first", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    const model = buildCostUsageModel({
      now,
      range: "7d",
      lines: [
        line({
          id: "inc",
          label: "Cursor 2026-09-20 included",
          periodStart: "2026-09-20T00:00:00.000Z",
          amountMinor: 200,
        }),
        line({
          id: "od",
          label: "Cursor 2026-09-22 on-demand",
          periodStart: "2026-09-22T00:00:00.000Z",
          amountMinor: 300,
        }),
        line({
          id: "host",
          category: "VERCEL_HOSTING",
          section: "Vercel Hosting",
          label: "Hosting",
          periodStart: "2026-09-21T00:00:00.000Z",
          amountMinor: 400,
        }),
        line({
          id: "old",
          label: "Cursor 2026-08-01 included",
          periodStart: "2026-08-01T00:00:00.000Z",
          amountMinor: 900,
        }),
      ],
    });

    expect(model.rangeLabel).toBe("20 Sep – 26 Sep");
    expect(model.totalLabel).toBe("£9.00");
    expect(model.includedLabel).toBe("£2.00");
    expect(model.onDemandLabel).toBe("£3.00");
    expect(model.infrastructureLabel).toBe("£4.00");
    expect(model.filteredLines.map((item) => item.id)).toEqual(["od", "host", "inc"]);
    expect(model.points).toHaveLength(7);
    expect(model.points[0]?.cumulative).toEqual({
      Included: 200,
      "On-demand": 0,
      "Vercel Hosting": 0,
    });
    expect(model.points.at(-1)?.cumulative).toEqual({
      Included: 200,
      "On-demand": 300,
      "Vercel Hosting": 400,
    });

    const many = Array.from({ length: COST_USAGE_PAGE_SIZE + 2 }, (_, index) =>
      line({ id: `row_${index}`, periodStart: `2026-09-${String(26 - index).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const page = paginateCostLines(many, 2);
    expect(page.totalPages).toBe(2);
    expect(page.pageLines).toHaveLength(2);
  });
});
