import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  getValidNextStatuses,
  calculateListingFee,
  formatPricePence,
  calculateExpiryDate,
  LISTING_FEES,
} from "@/lib/listing-status";

describe("isValidTransition", () => {
  it("allows DRAFT → PENDING", () => {
    expect(isValidTransition("DRAFT", "PENDING")).toBe(true);
  });

  it("allows PENDING → LIVE", () => {
    expect(isValidTransition("PENDING", "LIVE")).toBe(true);
  });

  it("allows PENDING → TAKEN_DOWN (rejection)", () => {
    expect(isValidTransition("PENDING", "TAKEN_DOWN")).toBe(true);
  });

  it("allows LIVE → EXPIRED", () => {
    expect(isValidTransition("LIVE", "EXPIRED")).toBe(true);
  });

  it("allows LIVE → TAKEN_DOWN", () => {
    expect(isValidTransition("LIVE", "TAKEN_DOWN")).toBe(true);
  });

  it("allows EXPIRED → DRAFT (renewal)", () => {
    expect(isValidTransition("EXPIRED", "DRAFT")).toBe(true);
  });

  it("disallows DRAFT → LIVE (must go through PENDING)", () => {
    expect(isValidTransition("DRAFT", "LIVE")).toBe(false);
  });

  it("disallows LIVE → DRAFT", () => {
    expect(isValidTransition("LIVE", "DRAFT")).toBe(false);
  });

  it("disallows TAKEN_DOWN → anything", () => {
    expect(isValidTransition("TAKEN_DOWN", "DRAFT")).toBe(false);
    expect(isValidTransition("TAKEN_DOWN", "LIVE")).toBe(false);
    expect(isValidTransition("TAKEN_DOWN", "PENDING")).toBe(false);
  });

  it("disallows EXPIRED → LIVE (must re-pay first)", () => {
    expect(isValidTransition("EXPIRED", "LIVE")).toBe(false);
  });
});

describe("getValidNextStatuses", () => {
  it("returns PENDING for DRAFT", () => {
    expect(getValidNextStatuses("DRAFT")).toEqual(["PENDING"]);
  });

  it("returns LIVE and TAKEN_DOWN for PENDING", () => {
    expect(getValidNextStatuses("PENDING")).toEqual(["LIVE", "TAKEN_DOWN"]);
  });

  it("returns empty array for TAKEN_DOWN", () => {
    expect(getValidNextStatuses("TAKEN_DOWN")).toEqual([]);
  });
});

describe("calculateListingFee", () => {
  it("returns standard fee for basic listing", () => {
    expect(calculateListingFee({})).toBe(LISTING_FEES.STANDARD_LISTING);
  });

  it("returns standard + featured fee for featured listing", () => {
    expect(calculateListingFee({ featured: true })).toBe(
      LISTING_FEES.STANDARD_LISTING + LISTING_FEES.FEATURED_UPGRADE
    );
  });

  it("returns 499 pence (£4.99) for standard listing", () => {
    expect(calculateListingFee({})).toBe(499);
  });

  it("returns 998 pence (£9.98) for featured listing", () => {
    expect(calculateListingFee({ featured: true })).toBe(998);
  });
});

describe("formatPricePence", () => {
  it("formats whole pound amounts without decimals", () => {
    expect(formatPricePence(1500000)).toBe("£15,000");
  });

  it("formats pence amounts with two decimals", () => {
    expect(formatPricePence(499)).toBe("£4.99");
  });

  it("formats zero", () => {
    expect(formatPricePence(0)).toBe("£0");
  });
});

describe("calculateExpiryDate", () => {
  it("returns a date 30 days in the future", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const expiry = calculateExpiryDate(now);
    const expected = new Date("2025-01-31T00:00:00Z");
    expect(expiry.getTime()).toBe(expected.getTime());
  });

  it("returns a Date object", () => {
    const result = calculateExpiryDate();
    expect(result).toBeInstanceOf(Date);
  });
});

describe("LISTING_FEES constants", () => {
  it("has correct standard listing fee", () => {
    expect(LISTING_FEES.STANDARD_LISTING).toBe(499);
  });

  it("has correct featured upgrade fee", () => {
    expect(LISTING_FEES.FEATURED_UPGRADE).toBe(499);
  });

  it("has correct dealer monthly fee", () => {
    expect(LISTING_FEES.DEALER_MONTHLY).toBe(2999);
  });
});
