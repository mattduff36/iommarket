import { describe, expect, it } from "vitest";
import {
  canViewListing,
  isListingEditable,
  isListingPubliclyVisible,
} from "@/lib/listings/visibility";

describe("listing visibility ALR-VIS-001", () => {
  it("keeps draft pending rejected and taken-down listings off the public web", () => {
    for (const status of ["DRAFT", "PENDING", "REJECTED", "TAKEN_DOWN", "EXPIRED"] as const) {
      expect(
        isListingPubliclyVisible({ status, expiresAt: new Date(Date.now() + 60_000) }),
      ).toBe(false);
    }
    expect(
      isListingPubliclyVisible({
        status: "LIVE",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe(true);
    expect(isListingPubliclyVisible({ status: "SOLD", expiresAt: null })).toBe(true);
  });

  it("lets owners and admins inspect moderated listings ALR-VIS-002", () => {
    expect(
      canViewListing({
        status: "TAKEN_DOWN",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "owner", role: "USER" },
      }),
    ).toBe(true);
    expect(
      canViewListing({
        status: "REJECTED",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "admin", role: "ADMIN" },
      }),
    ).toBe(true);
    expect(
      canViewListing({
        status: "REJECTED",
        expiresAt: null,
        listingUserId: "owner",
        viewer: { id: "stranger", role: "USER" },
      }),
    ).toBe(false);
  });

  it("limits photo edits to draft and expired listings", () => {
    expect(isListingEditable("DRAFT")).toBe(true);
    expect(isListingEditable("LIVE")).toBe(false);
    expect(isListingEditable("TAKEN_DOWN")).toBe(false);
  });
});
