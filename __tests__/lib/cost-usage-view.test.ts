import { describe, expect, it } from "vitest";
import type { CostLineDto } from "@/lib/costs/dto";
import {
  COST_USAGE_PAGE_SIZE,
  buildCostUsageModel,
  lineSeriesKey,
  paginateCostLines,
  summarizeCostLines,
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
    kind: overrides.kind ?? "CHARGE",
    invoiceability: overrides.invoiceability ?? "INVOICEABLE",
    periodStart: overrides.periodStart ?? "2026-09-26T00:00:00.000Z",
    periodEnd: overrides.periodEnd ?? "2026-09-27T00:00:00.000Z",
    provisional: overrides.provisional ?? false,
  };
}

describe("cost usage view", () => {
  it("maps every Cursor charge and both shared-hosting labels onto one series each", () => {
    expect(lineSeriesKey(line({ label: "Cursor 2026-09-26 included" }))).toBe(
      "Development (Cursor)",
    );
    expect(lineSeriesKey(line({ label: "Cursor 2026-09-26 on-demand" }))).toBe(
      "Development (Cursor)",
    );
    expect(
      lineSeriesKey(
        line({
          category: "VERCEL_HOSTING",
          section: "Vercel Hosting",
          label: "Hosting",
        }),
      ),
    ).toBe("Website hosting (Vercel)");
    expect(
      lineSeriesKey(
        line({
          category: "SHARED_VERCEL",
          section: "Provisional Shared Hosting",
          label: "Shared team charge",
        }),
      ),
    ).toBe("Shared Vercel services");
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
    expect(model.series).toEqual([
      { key: "Development (Cursor)", amountMinor: 500, amountLabel: "£5.00" },
      { key: "Website hosting (Vercel)", amountMinor: 400, amountLabel: "£4.00" },
    ]);
    expect(model.seriesKeys).toEqual(model.series.map((item) => item.key));
    expect(model.filteredLines.map((item) => item.id)).toEqual(["od", "host", "inc"]);
    expect(model.points).toHaveLength(7);
    expect(model.points[0]?.cumulative).toEqual({
      "Development (Cursor)": 200,
      "Website hosting (Vercel)": 0,
    });
    expect(model.points.at(-1)?.cumulative).toEqual({
      "Development (Cursor)": 500,
      "Website hosting (Vercel)": 400,
    });

    const many = Array.from({ length: COST_USAGE_PAGE_SIZE + 2 }, (_, index) =>
      line({ id: `row_${index}`, periodStart: `2026-09-${String(26 - index).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const page = paginateCostLines(many, 2);
    expect(page.totalPages).toBe(2);
    expect(page.pageLines).toHaveLength(2);
  });

  it("nets ledger revisions into useful client rows without changing totals", () => {
    const lines = [
      line({
        id: "cursor-included",
        label: "Cursor 2026-09-26 included",
        amountMinor: 60,
      }),
      line({
        id: "cursor-on-demand",
        label: "Cursor 2026-09-26 on-demand",
        amountMinor: 40,
      }),
      line({
        id: "function-old",
        category: "VERCEL_HOSTING",
        section: "Website hosting (Vercel)",
        label: "Functions",
        amountMinor: 25,
      }),
      line({
        id: "function-reversal",
        category: "VERCEL_HOSTING",
        section: "Website hosting (Vercel)",
        label: "Functions",
        amountMinor: -25,
        kind: "REVERSAL",
      }),
      line({
        id: "function-current",
        category: "VERCEL_HOSTING",
        section: "Website hosting (Vercel)",
        label: "Functions",
        amountMinor: 30,
      }),
      line({
        id: "zero-noise",
        category: "VERCEL_HOSTING",
        section: "Website hosting (Vercel)",
        label: "Edge Requests",
        amountMinor: 0,
      }),
      line({
        id: "credit",
        category: "VERCEL_HOSTING",
        section: "Website hosting (Vercel)",
        label: "Bandwidth credit",
        amountMinor: -2,
        kind: "REVERSAL",
      }),
    ];

    const summarized = summarizeCostLines(lines);

    expect(summarized.map((item) => [item.label, item.amountMinor, item.sourceCount])).toEqual([
      ["Development usage", 100, 2],
      ["Functions", 30, 3],
      ["Bandwidth credit", -2, 1],
    ]);
    expect(summarized.some((item) => item.label === "Edge Requests")).toBe(false);
    expect(summarized.reduce((total, item) => total + item.amountMinor, 0)).toBe(
      lines.reduce((total, item) => total + item.amountMinor, 0),
    );
  });
});
