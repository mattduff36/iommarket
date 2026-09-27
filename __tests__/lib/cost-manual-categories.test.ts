import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupCostSections, toCostLineDto } from "@/lib/costs/dto";

const { findUnique, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {
    siteSetting: { findUnique, upsert },
  },
}));

import {
  createManualCostCategory,
  DEFAULT_MANUAL_COST_CATEGORIES,
  listManualCostCategories,
  mergeManualCostCategories,
} from "@/lib/costs/manual-categories";

describe("manual cost categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
  });

  it("seeds the default categories and keeps a stored custom name", async () => {
    findUnique.mockResolvedValue({
      value: [{ slug: "office-supplies", label: "Office Supplies" }],
    });

    await expect(listManualCostCategories()).resolves.toEqual([
      ...DEFAULT_MANUAL_COST_CATEGORIES,
      { slug: "office-supplies", label: "Office Supplies" },
    ]);
  });

  it("rejects a duplicate name and persists a new one", async () => {
    await expect(createManualCostCategory("manual adjustment")).rejects.toThrow(
      /already exists/i,
    );
    expect(upsert).not.toHaveBeenCalled();

    findUnique.mockResolvedValue({
      value: [{ slug: "office-supplies", label: "Office Supplies" }],
    });
    const created = await createManualCostCategory("  Office  Equipment ");
    expect(created.category).toEqual({
      slug: "office-equipment",
      label: "Office Equipment",
    });
    expect(created.categories.map((category) => category.slug)).toEqual([
      ...DEFAULT_MANUAL_COST_CATEGORIES.map((category) => category.slug),
      "office-supplies",
      "office-equipment",
    ]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "cost_manual_categories" },
      }),
    );
  });

  it("ignores a stored category that repeats a default label", () => {
    expect(
      mergeManualCostCategories([
        { slug: "adjustment", label: "Manual Adjustment" },
        { slug: "office-supplies", label: "Office Supplies" },
      ]).map((category) => category.slug),
    ).toEqual([
      ...DEFAULT_MANUAL_COST_CATEGORIES.map((category) => category.slug),
      "office-supplies",
    ]);
  });

  it("renders each manual category as its own section and leaves database charges alone", () => {
    const sections = groupCostSections([
      toCostLineDto({
        id: "db",
        category: "DATABASE",
        kind: "CHARGE",
        displayLabel: "Supabase",
        markedGbpMinor: 100n,
        invoiceability: "INVOICEABLE",
        servicePeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        servicePeriodEnd: new Date("2026-09-02T00:00:00.000Z"),
      }),
      toCostLineDto({
        id: "adjust",
        category: "OTHER",
        kind: "CHARGE",
        displayLabel: "Exclude costs page work",
        markedGbpMinor: -1250n,
        invoiceability: "INVOICEABLE",
        servicePeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        servicePeriodEnd: new Date("2026-09-02T00:00:00.000Z"),
        manualSection: "Manual Adjustment",
      }),
      toCostLineDto({
        id: "software",
        category: "OTHER",
        kind: "CHARGE",
        displayLabel: "Domain tools",
        markedGbpMinor: 250n,
        invoiceability: "INVOICEABLE",
        servicePeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        servicePeriodEnd: new Date("2026-09-02T00:00:00.000Z"),
        manualSection: "Software & Subscriptions",
      }),
    ]);

    expect(sections.map((section) => section.label)).toEqual([
      "Database",
      "Manual Adjustment",
      "Software & Subscriptions",
    ]);
    expect(sections[1]?.lines.map((line) => line.amountMinor)).toEqual([-1250]);
  });
});
