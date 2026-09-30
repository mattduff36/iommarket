import { describe, expect, it } from "vitest";
import { buildAdminDealersWhere } from "@/lib/admin/dealer-query";
import {
  sampleDealerListingWhere,
  samplePrivateListingWhere,
} from "@/lib/listings/sample-visibility";
import {
  ADMIN_LISTING_STATUS_FILTERS,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  buildAdminUsersWhere,
  pendingFirstListingWhere,
  parseAdminListingStatus,
  parseAdminPage,
  splitPendingFirstPage,
} from "@/lib/admin/query";
import {
  adminPaymentTabHref,
  parsePaymentStatus,
  parsePaymentType,
  parseSubscriptionStatus,
} from "@/lib/admin/payment-filters";
import {
  LISTING_TABLE_COLUMNS,
  LISTING_TABLE_SORT,
  PAYMENT_TABLE_COLUMNS,
  PAYMENT_TABLE_SORT,
  SUBSCRIPTION_TABLE_COLUMNS,
  SUBSCRIPTION_TABLE_SORT,
} from "@/lib/admin/table-columns";
import {
  ADMIN_COLUMN_STORAGE_VERSION,
  ADMIN_TABLE_PAGE_SIZE,
  adminColumnStorageKey,
  adminSortHref,
  parseAdminSort,
  parseStoredColumnVisibility,
} from "@/lib/admin/table-state";

describe("admin listing archive ALR-ADM-001", () => {
  it("includes taken-down and rejected archive filters", () => {
    expect(ADMIN_LISTING_STATUS_FILTERS).toEqual(
      expect.arrayContaining(["TAKEN_DOWN", "REJECTED", "ALL"]),
    );
  });

  it("keeps search and status filters independent so older rows remain reachable", () => {
    expect(buildAdminListingArchiveWhere({ status: "TAKEN_DOWN", query: "" })).toEqual({
      status: "TAKEN_DOWN",
    });
    expect(buildAdminListingArchiveWhere({ status: "ALL", query: "" })).toEqual({
      status: { not: "ADMIN_PREVIEW" },
    });
    expect(buildAdminListingArchiveWhere({ status: "ALL", query: "bmw" })).toEqual({
      status: { not: "ADMIN_PREVIEW" },
      OR: [
        { title: { contains: "bmw", mode: "insensitive" } },
        { user: { email: { contains: "bmw", mode: "insensitive" } } },
      ],
    });
    expect(buildAdminListingArchiveWhere({ status: "PENDING", query: "bmw" })).toEqual({
      AND: [
        {
          OR: [
            { status: "PENDING" },
            { revisions: { some: { status: "PENDING" } } },
          ],
        },
        {
          OR: [
            { title: { contains: "bmw", mode: "insensitive" } },
            { user: { email: { contains: "bmw", mode: "insensitive" } } },
          ],
        },
      ],
    });
  });

  it("drops disabled sample listings from every moderation filter", () => {
    expect(
      buildAdminListingArchiveWhere({
        status: "ALL",
        query: "",
        sampleVisibility: { privateListings: false, dealerListings: false },
      }),
    ).toEqual({
      AND: [
        { status: { not: "ADMIN_PREVIEW" } },
        { NOT: samplePrivateListingWhere() },
        { NOT: sampleDealerListingWhere() },
      ],
    });
    expect(
      buildAdminListingArchiveWhere({
        status: "LIVE",
        query: "bmw",
        sampleVisibility: { privateListings: false, dealerListings: true },
      }),
    ).toEqual({
      AND: [
        {
          status: "LIVE",
          OR: [
            { title: { contains: "bmw", mode: "insensitive" } },
            { user: { email: { contains: "bmw", mode: "insensitive" } } },
          ],
        },
        { NOT: samplePrivateListingWhere() },
      ],
    });
  });

  it("keeps search inside both pending-first buckets", () => {
    const where = buildAdminListingArchiveWhere({ status: "ALL", query: "bmw" });
    const { pendingWhere, restWhere } = pendingFirstListingWhere(where);

    expect(pendingWhere).toEqual({
      AND: [
        where,
        {
          OR: [
            { status: "PENDING" },
            { revisions: { some: { status: "PENDING" } } },
          ],
        },
      ],
    });
    expect(restWhere).toEqual({
      AND: [
        where,
        {
          status: { not: "PENDING" },
          revisions: { none: { status: "PENDING" } },
        },
      ],
    });
  });

  it("does not drop the last page of terminal records", () => {
    expect(parseAdminPage("0")).toBe(1);
    expect(parseAdminPage("abc")).toBe(1);
    expect(adminTotalPages(51, 25)).toBe(3);
    expect(adminTotalPages(50, 25)).toBe(2);
  });

  it("defaults the listing archive to ALL and keeps pending rows first", () => {
    expect(parseAdminListingStatus(undefined)).toBe("ALL");
    expect(parseAdminListingStatus("LIVE")).toBe("LIVE");
    expect(ADMIN_LISTING_STATUS_FILTERS[0]).toBe("ALL");
    expect(splitPendingFirstPage({ page: 1, pageSize: 25, pendingCount: 3 })).toEqual({
      pending: { skip: 0, take: 3 },
      rest: { skip: 0, take: 22 },
    });
    expect(splitPendingFirstPage({ page: 2, pageSize: 25, pendingCount: 3 })).toEqual({
      pending: { skip: 0, take: 0 },
      rest: { skip: 22, take: 25 },
    });
  });
});

describe("admin table sorting", () => {
  const current = { status: "LIVE", q: "bmw", page: "4" };

  it("rejects unknown sorts and reverses only an explicit column", () => {
    expect(parseAdminSort({}, LISTING_TABLE_COLUMNS, LISTING_TABLE_SORT)).toEqual({
      column: "created",
      direction: "desc",
      explicit: false,
    });
    expect(parseAdminSort(
      { sort: "not-a-column", dir: "asc" },
      LISTING_TABLE_COLUMNS,
      LISTING_TABLE_SORT,
    ).explicit).toBe(false);
    expect(parseAdminSort(
      { sort: "price", dir: "sideways" },
      LISTING_TABLE_COLUMNS,
      LISTING_TABLE_SORT,
    )).toEqual({ column: "price", direction: "desc", explicit: true });

    const active = parseAdminSort(
      { sort: "title", dir: "asc" },
      LISTING_TABLE_COLUMNS,
      LISTING_TABLE_SORT,
    );
    const title = LISTING_TABLE_COLUMNS.find((column) => column.id === "title");
    const price = LISTING_TABLE_COLUMNS.find((column) => column.id === "price");
    if (!title || !price) throw new Error("Expected sortable listing columns.");

    const reversed = new URL(adminSortHref({
      pathname: "/admin/listings",
      current,
      sort: active,
      column: title,
    }), "https://iommarket.test");
    expect(reversed.searchParams.get("sort")).toBe("title");
    expect(reversed.searchParams.get("dir")).toBe("desc");
    expect(reversed.searchParams.get("page")).toBe("1");
    expect(reversed.searchParams.get("status")).toBe("LIVE");
    expect(reversed.searchParams.get("q")).toBe("bmw");

    const firstPriceSort = new URL(adminSortHref({
      pathname: "/admin/listings",
      current,
      sort: active,
      column: price,
    }), "https://iommarket.test");
    expect(firstPriceSort.searchParams.get("dir")).toBe("desc");
  });

  it("ignores corrupt or pinned column preferences", () => {
    expect(parseStoredColumnVisibility("{", LISTING_TABLE_COLUMNS)).toEqual([
      "region",
      "featured",
      "views",
      "expires",
    ]);
    expect(parseStoredColumnVisibility(
      JSON.stringify({ v: 1, hidden: ["title", "seller", "unknown"] }),
      LISTING_TABLE_COLUMNS,
    )).toEqual(["seller"]);
  });

  it("pages complete filtered datasets instead of a fixed cap", () => {
    expect(adminTotalPages(500, ADMIN_TABLE_PAGE_SIZE)).toBe(20);
    expect(adminTotalPages(51, ADMIN_TABLE_PAGE_SIZE)).toBe(3);
    expect((2 - 1) * ADMIN_TABLE_PAGE_SIZE).toBe(25);
  });

  it("versions column storage with the preference contract", () => {
    expect(adminColumnStorageKey("listings")).toBe(
      `iommarket.admin.columns.v${ADMIN_COLUMN_STORAGE_VERSION}:listings`,
    );
  });

  it("drops a payment sort that does not match one displayed field", () => {
    expect(parseAdminSort(
      { sort: "reference", dir: "asc" },
      PAYMENT_TABLE_COLUMNS,
      PAYMENT_TABLE_SORT,
    )).toEqual({ column: "date", direction: "desc", explicit: false });
    expect(parseAdminSort(
      { sort: "period", dir: "desc" },
      SUBSCRIPTION_TABLE_COLUMNS,
      SUBSCRIPTION_TABLE_SORT,
    )).toEqual({ column: "created", direction: "desc", explicit: false });
  });
});

describe("admin payment filters", () => {
  it("rejects a status from the other payments tab", () => {
    expect(parsePaymentStatus("SUCCEEDED")).toBe("SUCCEEDED");
    expect(parseSubscriptionStatus("SUCCEEDED")).toBeUndefined();
    expect(parseSubscriptionStatus("ACTIVE")).toBe("ACTIVE");
    expect(parsePaymentStatus("ACTIVE")).toBeUndefined();
    expect(parsePaymentType("LISTING")).toBe("LISTING");
    expect(parsePaymentType("ACTIVE")).toBeUndefined();
  });

  it("clears incompatible filters when the payments tab changes", () => {
    const href = new URL(adminPaymentTabHref({
      tab: "payments",
      q: "bmw",
      status: "SUCCEEDED",
      type: "LISTING",
      sort: "amount",
      dir: "desc",
      page: "4",
    }, "subscriptions"), "https://iommarket.test");

    expect(href.pathname).toBe("/admin/payments");
    expect(href.searchParams.get("tab")).toBe("subscriptions");
    expect(href.searchParams.get("page")).toBe("1");
    expect(href.searchParams.get("q")).toBe("bmw");
    expect(href.searchParams.has("status")).toBe(false);
    expect(href.searchParams.has("type")).toBe(false);
    expect(href.searchParams.has("sort")).toBe(false);
    expect(href.searchParams.has("dir")).toBe(false);
  });
});

describe("admin users list", () => {
  it("excludes preview system accounts from the default users query", () => {
    expect(buildAdminUsersWhere({})).toEqual({
      NOT: [
        { email: { endsWith: "@preview.internal", mode: "insensitive" } },
        { authUserId: { startsWith: "preview-system:" } },
        { dealerProfile: { isAdminPreview: true } },
      ],
    });
  });

  it("keeps search and role filters while still hiding preview dealers", () => {
    expect(
      buildAdminUsersWhere({ query: "manx", role: "DEALER" }),
    ).toEqual({
      NOT: [
        { email: { endsWith: "@preview.internal", mode: "insensitive" } },
        { authUserId: { startsWith: "preview-system:" } },
        { dealerProfile: { isAdminPreview: true } },
      ],
      OR: [
        { email: { contains: "manx", mode: "insensitive" } },
        { name: { contains: "manx", mode: "insensitive" } },
      ],
      role: "DEALER",
    });
  });
});

describe("admin dealers list", () => {
  it("honours an exact dealer id without dropping search or verification filters", () => {
    expect(
      buildAdminDealersWhere({ id: " dealer-1 ", query: "td", verified: false }),
    ).toMatchObject({
      id: "dealer-1",
      isAdminPreview: false,
      verified: false,
      OR: [
        { name: { contains: "td", mode: "insensitive" } },
        { slug: { contains: "td", mode: "insensitive" } },
        { user: { email: { contains: "td", mode: "insensitive" } } },
      ],
    });
    expect(buildAdminDealersWhere({ id: "   " })).not.toHaveProperty("id");
  });
});
