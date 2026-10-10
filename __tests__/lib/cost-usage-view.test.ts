import { describe, expect, it } from "vitest";
import type { CostLineDto } from "@/lib/costs/dto";
import {
  COST_USAGE_PAGE_SIZE,
  buildCostUsageModel,
  lineSeriesKey,
  paginateCostLines,
  summarizeCostLines,
  toCostBillingDisplay,
  usageRangeBounds,
  type CostBillingDisplay,
  type CostUsageRange,
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
    ).toBe("Website hosting (Vercel)");
    expect(
      lineSeriesKey(
        line({
          category: "OTHER",
          section: "Manual Adjustment",
          label: "Exclude costs page work",
        }),
      ),
    ).toBe("Manual Adjustment");
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

  it("keeps a manual category as its own chart series", () => {
    const model = buildCostUsageModel({
      now: new Date("2026-09-26T12:00:00.000Z"),
      range: "7d",
      lines: [
        line({
          id: "manual",
          category: "OTHER",
          section: "Software & Subscriptions",
          label: "Domain tools",
          periodStart: "2026-09-24T00:00:00.000Z",
          amountMinor: 250,
        }),
      ],
    });

    expect(model.seriesKeys).toContain("Software & Subscriptions");
    expect(model.series.map((item) => item.key)).toEqual(["Software & Subscriptions"]);
  });
});

const AS_OF = "2026-10-10T18:00:00.000Z";

function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

function billedLine(id: string, day: string, amountMinor: number, category: CostLineDto["category"]): CostLineDto {
  return line({
    id,
    category,
    section: category === "VERCEL_HOSTING" ? "Website hosting (Vercel)" : "Development (Cursor)",
    label: id,
    periodStart: `${day}T00:00:00.000Z`,
    amountMinor,
  });
}

function acceptanceBilling(options?: { invoicesAvailable?: boolean; dropDay?: string }): CostBillingDisplay {
  const history = eachDay("2026-05-27", "2026-10-10").flatMap((day) => {
    if (options?.dropDay === day) return [];
    const invoicedPence = day >= "2026-10-04" ? 95_000 : day >= "2026-08-08" ? 70_000 : 50_000;
    let cost: number | null = null;
    if (day >= "2026-08-01") cost = 20_000;
    if (day >= "2026-09-10" && cost !== null) cost += 10_000;
    if (day >= "2026-10-01" && cost !== null) cost += 5_000;
    if (day >= "2026-10-06" && cost !== null) cost += 15_737;
    return [{
      day,
      invoicedPence,
      remainingToInvoicePence: cost === null ? null : cost - invoicedPence,
    }];
  });
  return toCostBillingDisplay({
    invoicedPence: options?.invoicesAvailable === false ? null : 95_000,
    asOf: AS_OF,
    history,
  });
}

const acceptanceLines = [
  billedLine("august-hosting", "2026-08-01", 20_000, "VERCEL_HOSTING"),
  billedLine("september-development", "2026-09-10", 10_000, "CURSOR"),
  billedLine("october-open", "2026-10-01", 5_000, "CURSOR"),
  billedLine("october-week", "2026-10-06", 15_737, "CURSOR"),
];

function acceptanceModel(range: CostUsageRange, billing = acceptanceBilling()) {
  return buildCostUsageModel({ lines: acceptanceLines, range, billing, now: new Date("2020-01-01T00:00:00.000Z") });
}

describe("accounts billing usage history", () => {
  it("keeps lifetime invoice and cost balances inside every preset range", () => {
    const week = acceptanceModel("7d");
    expect(week.fromDay).toBe("2026-10-04");
    expect(week.toDay).toBe("2026-10-10");
    expect(week.points[0]?.invoicedPence).toBe(95_000);
    expect(week.points[0]?.cumulative).toMatchObject({
      "Development (Cursor)": 15_000,
      "Website hosting (Vercel)": 20_000,
    });
    expect(week.points.at(-1)?.remainingToInvoicePence).toBe(-44_263);
    expect(week.points.at(-1)?.cumulative).toMatchObject({
      "Development (Cursor)": 30_737,
      "Website hosting (Vercel)": 20_000,
    });
    expect(week.series).toEqual([
      { key: "Development (Cursor)", amountMinor: 15_737, amountLabel: "£157.37" },
    ]);
    expect(week.chartSeriesKeys).toContain("Website hosting (Vercel)");
    expect(week.points.reduce((total, point) => total + (point.daily["Website hosting (Vercel)"] ?? 0), 0)).toBe(0);

    const monthToDate = acceptanceModel("mtd");
    expect(monthToDate.points[0]?.invoicedPence).toBe(70_000);
    expect(monthToDate.points[0]?.cumulative["Website hosting (Vercel)"]).toBe(20_000);
    expect(monthToDate.points.find((point) => point.day === "2026-10-03")?.invoicedPence).toBe(70_000);

    const lastMonth = acceptanceModel("last-month");
    expect(lastMonth.fromDay).toBe("2026-09-01");
    expect(lastMonth.points.every((point) => point.invoicedPence === 70_000)).toBe(true);
    expect(lastMonth.points[0]?.cumulative["Website hosting (Vercel)"]).toBe(20_000);
    expect(lastMonth.series.map((item) => item.amountMinor)).toEqual([10_000]);

    const thirty = acceptanceModel("30d");
    expect(thirty.fromDay).toBe("2026-09-11");
    expect(thirty.points[0]?.invoicedPence).toBe(70_000);
    expect(thirty.points[0]?.cumulative["Development (Cursor)"]).toBe(10_000);

    const all = acceptanceModel("all");
    expect(all.points[0]).toMatchObject({
      day: "2026-05-27",
      invoicedPence: 50_000,
      remainingToInvoicePence: null,
    });
    expect(all.points[0]?.cumulative["Development (Cursor)"]).toBeNull();
    expect(all.points[0]?.cumulative["Website hosting (Vercel)"]).toBeNull();
    expect(all.toDay).toBe("2026-10-10");
    expect(all.points.at(-1)?.remainingToInvoicePence).toBe(-44_263);
    expect(all.series.reduce((total, item) => total + item.amountMinor, 0)).toBe(50_737);
  });

  it("preserves credits, zero, null gaps and invoice-only history without inventing balances", () => {
    const credited = buildCostUsageModel({
      lines: [],
      range: "all",
      billing: toCostBillingDisplay({
        invoicedPence: 400,
        asOf: "2026-10-06T00:00:00.000Z",
        history: [
          { day: "2026-10-04", invoicedPence: 1_000, remainingToInvoicePence: -1_000 },
          { day: "2026-10-05", invoicedPence: 1_000, remainingToInvoicePence: 0 },
          { day: "2026-10-06", invoicedPence: 400, remainingToInvoicePence: -400 },
        ],
      }),
    });
    expect(credited.points.map((point) => point.invoicedPence)).toEqual([1_000, 1_000, 400]);
    expect(credited.points.map((point) => point.remainingToInvoicePence)).toEqual([-1_000, 0, -400]);
    expect(credited.series).toEqual([]);

    const gapped = acceptanceModel("7d", acceptanceBilling({ dropDay: "2026-10-05" }));
    const missing = gapped.points.find((point) => point.day === "2026-10-05");
    expect(missing?.invoicedPence).toBeNull();
    expect(missing?.remainingToInvoicePence).toBeNull();
    expect(gapped.points.find((point) => point.day === "2026-10-06")?.invoicedPence).toBe(95_000);

    const conflicted = acceptanceModel("7d", acceptanceBilling({ invoicesAvailable: false }));
    expect(conflicted.invoicesAvailable).toBe(false);
    expect(conflicted.points.every((point) => point.invoicedPence === null)).toBe(true);
    expect(conflicted.points.at(-1)?.remainingToInvoicePence).toBe(-44_263);

    const invoiceOnly = buildCostUsageModel({
      lines: [],
      range: "all",
      billing: acceptanceBilling(),
    });
    expect(invoiceOnly.points[0]?.invoicedPence).toBe(50_000);
    expect(invoiceOnly.points[0]?.remainingToInvoicePence).toBeNull();
    expect(invoiceOnly.seriesKeys).toEqual([]);
    expect(invoiceOnly.points.at(-1)?.day).toBe("2026-10-10");
  });

  it("leaves callers without billing data on the period-only cumulative", () => {
    const model = buildCostUsageModel({
      now: new Date("2026-10-10T12:00:00.000Z"),
      range: "7d",
      lines: acceptanceLines,
    });
    expect(model.billingApplied).toBe(false);
    expect(model.invoicesAvailable).toBe(false);
    expect(model.points[0]?.cumulative["Website hosting (Vercel)"]).toBeUndefined();
    expect(model.points[0]?.invoicedPence).toBeNull();
    expect(model.series.reduce((total, item) => total + item.amountMinor, 0)).toBe(15_737);
    expect(model.chartSeriesKeys).toEqual(model.seriesKeys);
  });
});
