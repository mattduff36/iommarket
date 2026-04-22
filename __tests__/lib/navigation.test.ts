import { describe, expect, it } from "vitest";
import {
  getAccountNavItems,
  getRoleLabel,
  getSellLandingPath,
  PUBLIC_NAV_ITEMS,
} from "@/lib/navigation";

describe("getSellLandingPath", () => {
  it("sends private sellers to the private listing flow", () => {
    expect(getSellLandingPath("USER")).toBe("/sell/private");
  });

  it("sends dealers to the dealer listing flow", () => {
    expect(getSellLandingPath("DEALER")).toBe("/sell/dealer");
  });

  it("does not redirect admins or guests", () => {
    expect(getSellLandingPath("ADMIN")).toBeNull();
    expect(getSellLandingPath(null)).toBeNull();
    expect(getSellLandingPath(undefined)).toBeNull();
  });
});

describe("getAccountNavItems", () => {
  it("keeps dealer-only items hidden from regular users while keeping buyer tools visible", () => {
    const userItems = getAccountNavItems("USER");

    expect(userItems.some((item) => item.href === "/account/favourites")).toBe(true);
    expect(userItems.some((item) => item.href === "/account/saved-searches")).toBe(true);
    expect(userItems.some((item) => item.href === "/dealer/profile")).toBe(false);
    expect(userItems.some((item) => item.href === "/admin")).toBe(false);
  });
});

describe("getRoleLabel", () => {
  it("shows customer-friendly labels for account roles", () => {
    expect(getRoleLabel("USER")).toBe("Member");
    expect(getRoleLabel("DEALER")).toBe("Dealer");
    expect(getRoleLabel("ADMIN")).toBe("Admin");
    expect(getRoleLabel(null)).toBeNull();
  });
});

describe("PUBLIC_NAV_ITEMS", () => {
  it("includes the vehicle check page in public navigation", () => {
    expect(
      PUBLIC_NAV_ITEMS.some((item) => item.href === "/vehicle-check")
    ).toBe(true);
  });
});
