import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  getValidNextStatuses,
  formatPricePence,
  calculateExpiryDate,
  LISTING_DURATION_DAYS,
} from "@/lib/listing-status";

describe("isValidTransition", () => {
  it("allows DRAFT → PENDING", () => {
    expect(isValidTransition("DRAFT", "PENDING")).toBe(true);
  });

  it("allows PENDING → LIVE", () => {
    expect(isValidTransition("PENDING", "LIVE")).toBe(true);
  });

  it("allows PENDING → REJECTED (rejection)", () => {
    expect(isValidTransition("PENDING", "REJECTED")).toBe(true);
  });

  it("allows LIVE → EXPIRED", () => {
    expect(isValidTransition("LIVE", "EXPIRED")).toBe(true);
  });

  it("allows LIVE → TAKEN_DOWN", () => {
    expect(isValidTransition("LIVE", "TAKEN_DOWN")).toBe(true);
  });

  it("allows LIVE → SOLD", () => {
    expect(isValidTransition("LIVE", "SOLD")).toBe(true);
  });

  it("disallows SOLD → anything", () => {
    expect(isValidTransition("SOLD", "DRAFT")).toBe(false);
    expect(isValidTransition("SOLD", "LIVE")).toBe(false);
    expect(isValidTransition("SOLD", "PENDING")).toBe(false);
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

  it("allows TAKEN_DOWN restore paths only", () => {
    expect(isValidTransition("TAKEN_DOWN", "DRAFT")).toBe(true);
    expect(isValidTransition("TAKEN_DOWN", "LIVE")).toBe(true);
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

  it("returns LIVE and REJECTED for PENDING", () => {
    expect(getValidNextStatuses("PENDING")).toEqual(["LIVE", "REJECTED"]);
  });

  it("returns restore targets for TAKEN_DOWN", () => {
    expect(getValidNextStatuses("TAKEN_DOWN")).toEqual(["LIVE", "DRAFT"]);
  });
});

describe("formatPricePence", () => {
  it("formats whole pound amounts with GBP precision", () => {
    expect(formatPricePence(1500000)).toBe("£15,000.00");
  });

  it("formats pence amounts with two decimals", () => {
    expect(formatPricePence(499)).toBe("£4.99");
  });

  it("formats zero", () => {
    expect(formatPricePence(0)).toBe("£0.00");
  });
});

describe("calculateExpiryDate", () => {
  it("returns a date 60 days in the future", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const expiry = calculateExpiryDate(now);
    const expected = new Date("2025-03-02T00:00:00Z");
    expect(expiry.getTime()).toBe(expected.getTime());
  });

  it("uses the 60-day listing duration", () => {
    expect(LISTING_DURATION_DAYS).toBe(60);
  });

  it("returns a Date object", () => {
    const result = calculateExpiryDate();
    expect(result).toBeInstanceOf(Date);
  });
});
