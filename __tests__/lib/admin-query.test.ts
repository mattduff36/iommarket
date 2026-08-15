import { describe, expect, it } from "vitest";
import {
  ADMIN_LISTING_STATUS_FILTERS,
  adminTotalPages,
  buildAdminListingArchiveWhere,
  parseAdminPage,
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
    expect(buildAdminListingArchiveWhere({ status: "ALL", query: "bmw" })).toEqual({
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
});
