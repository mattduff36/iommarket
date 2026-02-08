import { describe, it, expect } from "vitest";
import {
  createListingSchema,
  reportListingSchema,
  moderateListingSchema,
} from "@/lib/validations/listing";

describe("createListingSchema", () => {
  const validInput = {
    title: "2019 BMW 320d M Sport",
    description: "Low mileage, full service history, excellent condition throughout.",
    price: 1500000, // £15,000 in pence
    categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    regionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
  };

  it("accepts valid input", () => {
    const result = createListingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects title shorter than 5 characters", () => {
    const result = createListingSchema.safeParse({ ...validInput, title: "Car" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.title).toBeDefined();
    }
  });

  it("rejects description shorter than 20 characters", () => {
    const result = createListingSchema.safeParse({
      ...validInput,
      description: "Too short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects price below minimum (100 pence = £1)", () => {
    const result = createListingSchema.safeParse({ ...validInput, price: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects price above maximum", () => {
    const result = createListingSchema.safeParse({
      ...validInput,
      price: 200_000_000,
    });
    expect(result.success).toBe(false);
  });

  it("defaults attributes to empty array", () => {
    const result = createListingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attributes).toEqual([]);
    }
  });
});

describe("reportListingSchema", () => {
  it("accepts valid report", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "test@example.com",
      reason: "This listing appears to be a scam with fake photos",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "not-an-email",
      reason: "This listing appears to be a scam with fake photos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short reason", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "test@example.com",
      reason: "Bad",
    });
    expect(result.success).toBe(false);
  });
});

describe("moderateListingSchema", () => {
  it("accepts APPROVE action", () => {
    const result = moderateListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "APPROVE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = moderateListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});
