import { describe, it, expect } from "vitest";
import {
  createListingSchema,
  reportListingSchema,
  moderateListingSchema,
  takeDownFromReportSchema,
} from "@/lib/validations/listing";

describe("createListingSchema", () => {
  const validInput = {
    title: "2019 BMW 320d M Sport",
    description: "Low mileage, full service history, excellent condition throughout.",
    price: 1500000, // £15,000 in pence
    categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    regionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    trustDeclarationAccepted: true,
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

  it("trims title, description, and attribute values", () => {
    const result = createListingSchema.safeParse({
      ...validInput,
      title: "  2019 BMW 320d M Sport  ",
      description: "  Low mileage, full service history, excellent condition throughout.  ",
      attributes: [
        {
          attributeDefinitionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
          value: "  BMW  ",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("2019 BMW 320d M Sport");
      expect(result.data.description).toBe(
        "Low mileage, full service history, excellent condition throughout."
      );
      expect(result.data.attributes[0]?.value).toBe("BMW");
    }
  });

  it("rejects NaN prices", () => {
    const result = createListingSchema.safeParse({ ...validInput, price: Number.NaN });
    expect(result.success).toBe(false);
  });
});

describe("reportListingSchema", () => {
  it("accepts valid report", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "test@example.com",
      reasonCode: "FRAUD",
      reason: "This listing appears to be a scam with fake photos",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "not-an-email",
      reasonCode: "FRAUD",
      reason: "This listing appears to be a scam with fake photos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short reason", () => {
    const result = reportListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      reporterEmail: "test@example.com",
      reasonCode: "FRAUD",
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
      expectedRevision: 0,
    });
    expect(result.success).toBe(true);
  });

  it("requires a reason for take-down", () => {
    const result = moderateListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "TAKE_DOWN",
      expectedRevision: 1,
    });
    expect(result.success).toBe(false);
  });

  it("requires notes when take-down from report uses Other ALR-RPT-001", () => {
    const result = takeDownFromReportSchema.safeParse({
      reportId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      expectedRevision: 1,
      reasonCode: "OTHER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid action", () => {
    const result = moderateListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});
