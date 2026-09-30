import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PreviewPackListRow } from "@/lib/preview-packs/archive";
import {
  CANCELLATION_TABLE_COLUMNS,
  DEALER_TABLE_COLUMNS,
  LISTING_TABLE_COLUMNS,
  PAGE_TABLE_COLUMNS,
  PAYMENT_TABLE_COLUMNS,
  PREVIEW_PACK_TABLE_COLUMNS,
  SUBSCRIPTION_TABLE_COLUMNS,
  USER_TABLE_COLUMNS,
  WAITLIST_TABLE_COLUMNS,
} from "@/lib/admin/table-columns";
import {
  cancellationOrderBy,
  contentPageOrderBy,
  dealerOrderBy,
  listingOrderBy,
  paymentOrderBy,
  sortPreviewPackRows,
  subscriptionOrderBy,
  userOrderBy,
  waitlistOrderBy,
} from "@/lib/admin/table-order";
import type { AdminColumn, AdminSortState } from "@/lib/admin/table-state";

function sortFor(column: AdminColumn): AdminSortState {
  return {
    column: column.id,
    direction: column.defaultDirection ?? "asc",
    explicit: true,
  };
}

function expectStableOrder(order: ReadonlyArray<Record<string, unknown>>) {
  expect(order.at(-1)).toEqual({ id: "asc" });
  expect(order.length).toBeGreaterThan(1);
}

describe("admin table order mappings", () => {
  it("sorts every deterministic listing column with a stable id tie-break", () => {
    for (const column of LISTING_TABLE_COLUMNS) {
      if (!column.defaultDirection) continue;
      const order = listingOrderBy(sortFor(column));
      expectStableOrder(order);
    }
    expect(listingOrderBy(sortFor(
      LISTING_TABLE_COLUMNS.find((column) => column.id === "approved")!,
    ))).toEqual([{ approvedAt: "desc" }, { id: "asc" }]);
    expect(listingOrderBy(sortFor(
      LISTING_TABLE_COLUMNS.find((column) => column.id === "reports")!,
    ))).toEqual([{ reports: { _count: "desc" } }, { id: "asc" }]);
    expect(listingOrderBy(sortFor(
      LISTING_TABLE_COLUMNS.find((column) => column.id === "seller")!,
    ))).toEqual([
      { user: { name: "asc" } },
      { user: { email: "asc" } },
      { id: "asc" },
    ]);
  });

  it("maps the other primary tables onto their scalar or relation fields", () => {
    expect(userOrderBy({ column: "listings", direction: "asc", explicit: true })).toEqual([
      { listings: { _count: "asc" } },
      { id: "asc" },
    ]);
    expect(dealerOrderBy({ column: "owner", direction: "desc", explicit: true })).toEqual([
      { user: { name: "desc" } },
      { user: { email: "desc" } },
      { id: "asc" },
    ]);
    expect(paymentOrderBy({ column: "refunded", direction: "desc", explicit: true })).toEqual([
      { refundedAt: "desc" },
      { id: "asc" },
    ]);
    expect(PAYMENT_TABLE_COLUMNS.find((column) => column.id === "reference")?.defaultDirection).toBeUndefined();
    expect(SUBSCRIPTION_TABLE_COLUMNS.find((column) => column.id === "period")?.defaultDirection).toBeUndefined();
    expect(SUBSCRIPTION_TABLE_COLUMNS.find((column) => column.id === "reference")?.defaultDirection).toBeUndefined();
    expect(subscriptionOrderBy({ column: "cancel", direction: "desc", explicit: true })).toEqual([
      { cancelAtPeriodEnd: "desc" },
      { id: "asc" },
    ]);
    expect(waitlistOrderBy({ column: "consent", direction: "asc", explicit: true })).toEqual([
      { marketingConsentAt: "asc" },
      { id: "asc" },
    ]);
    expect(contentPageOrderBy({ column: "published", direction: "desc", explicit: true })).toEqual([
      { publishedAt: "desc" },
      { id: "asc" },
    ]);
    expect(cancellationOrderBy({ column: "processed", direction: "asc", explicit: true })).toEqual([
      { processedAt: "asc" },
      { id: "asc" },
    ]);

    for (const [columns, orderFor] of [
      [USER_TABLE_COLUMNS, userOrderBy],
      [DEALER_TABLE_COLUMNS, dealerOrderBy],
      [PAYMENT_TABLE_COLUMNS, paymentOrderBy],
      [SUBSCRIPTION_TABLE_COLUMNS, subscriptionOrderBy],
      [WAITLIST_TABLE_COLUMNS, waitlistOrderBy],
      [PAGE_TABLE_COLUMNS, contentPageOrderBy],
      [CANCELLATION_TABLE_COLUMNS, cancellationOrderBy],
    ] as const) {
      for (const column of columns) {
        if (!column.defaultDirection) continue;
        expectStableOrder(orderFor(sortFor(column)));
      }
    }
  });

  it("sorts preview packs in memory and keeps missing numbers last", () => {
    const rows: PreviewPackListRow[] = [
      row("b", "Beta", 2, null),
      row("a", "Alpha", null, 10),
      row("c", "Alpha", 9, 1),
    ];
    expect(sortPreviewPackRows(rows, {
      column: "dealer",
      direction: "asc",
      explicit: true,
    }).map((item) => item.dealerKey)).toEqual(["a", "c", "b"]);
    expect(sortPreviewPackRows(rows, {
      column: "importable",
      direction: "desc",
      explicit: true,
    }).map((item) => item.dealerKey)).toEqual(["c", "b", "a"]);
    expect(sortPreviewPackRows(rows, {
      column: "vehicles",
      direction: "asc",
      explicit: true,
    }).map((item) => item.dealerKey)).toEqual(["c", "a", "b"]);
    expect(PREVIEW_PACK_TABLE_COLUMNS.find((column) => column.id === "status")?.defaultDirection)
      .toBeUndefined();
  });

  it("backfills the earliest admin approval without replacing a stored date", () => {
    const sql = readFileSync(
      "prisma/migrations/20260929233000_listing_approved_at/migration.sql",
      "utf8",
    );
    expect(sql).toContain('ADD COLUMN "approvedAt" TIMESTAMP(3)');
    expect(sql).toContain('CREATE INDEX "Listing_approvedAt_idx"');
    expect(sql).toContain(`WHERE "source" = 'ADMIN'`);
    expect(sql).toContain(`AND "action" = 'APPROVE'`);
    expect(sql).toContain('MIN("createdAt")');
    expect(sql).toContain('AND listing."approvedAt" IS NULL');
  });
});

function row(
  dealerKey: string,
  displayName: string,
  importable: number | null,
  uniqueVehicles: number | null,
): PreviewPackListRow {
  return {
    dealerKey,
    displayName,
    runId: `${dealerKey}-run`,
    importable,
    uniqueVehicles,
    listingCount: importable ?? 0,
    enabled: false,
    loaded: true,
    materialized: (importable ?? 0) > 0,
    slug: null,
    reviewRequired: false,
    reviewReasons: [],
    reviewSourceRunId: null,
  };
}
