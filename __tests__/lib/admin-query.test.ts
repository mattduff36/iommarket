import { describe, expect, it } from "vitest";
import {
  ADMIN_LISTING_STATUS_FILTERS,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  buildAdminUsersWhere,
  parseAdminListingStatus,
  parseAdminPage,
  splitPendingFirstPage,
} from "@/lib/admin/query";

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
