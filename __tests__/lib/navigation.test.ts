import { describe, expect, it } from "vitest";
import { getAccountNavItems, getSellLandingPath } from "@/lib/navigation";

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
  it("keeps dealer-only items hidden from regular users", () => {
    const userItems = getAccountNavItems("USER");

    expect(userItems.some((item) => item.href === "/dealer/profile")).toBe(false);
    expect(userItems.some((item) => item.href === "/admin")).toBe(false);
  });
});
