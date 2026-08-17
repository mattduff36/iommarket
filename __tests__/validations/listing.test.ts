import { describe, it, expect } from "vitest";
import {
  createListingSchema,
  updateListingSchema,
  reportListingSchema,
  moderateListingSchema,
  takeDownFromReportSchema,
  contactSellerSchema,
  syncListingImagesSchema,
} from "@/lib/validations/listing";
import { FEATURED_LISTING_PHOTO_LIMIT } from "@/lib/listings/photo-limits";

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

  it("LST-ATTR-ID-001 accepts bounded opaque attribute IDs in create and update inputs", () => {
    const deterministicId = "attr_writeoff_cmn3oefbu0001twzjvgysi1k5";
    const attributes = [
      {
        attributeDefinitionId: `  ${deterministicId}  `,
        value: "None",
      },
    ];

    const createResult = createListingSchema.safeParse({
      ...validInput,
      attributes,
    });
    expect(createResult.success).toBe(true);
    if (createResult.success) {
      expect(createResult.data.attributes[0]?.attributeDefinitionId).toBe(
        deterministicId,
      );
    }

    expect(
      updateListingSchema.safeParse({
        id: "cllisting123456789012345678",
        attributes,
      }).success,
    ).toBe(true);
  });

  it.each(["", "   ", "x".repeat(101)])(
    "LST-ATTR-ID-001 rejects invalid attribute ID %j",
    (attributeDefinitionId) => {
      expect(
        createListingSchema.safeParse({
          ...validInput,
          attributes: [{ attributeDefinitionId, value: "None" }],
        }).success,
      ).toBe(false);
    },
  );

  it("LST-ATTR-ID-001 keeps entity IDs CUID-only", () => {
    expect(
      createListingSchema.safeParse({
        ...validInput,
        categoryId: "attr_writeoff_cmn3oefbu0001twzjvgysi1k5",
      }).success,
    ).toBe(false);
    expect(
      createListingSchema.safeParse({
        ...validInput,
        regionId: "region_iom",
      }).success,
    ).toBe(false);
    expect(
      updateListingSchema.safeParse({
        id: "listing_opaque",
        attributes: [],
      }).success,
    ).toBe(false);
  });

  it("requires the expanded listing declarations POL-LIST-001", () => {
    const result = createListingSchema.safeParse({
      ...validInput,
      trustDeclarationAccepted: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects NaN prices", () => {
    const result = createListingSchema.safeParse({ ...validInput, price: Number.NaN });
    expect(result.success).toBe(false);
  });
});

describe("syncListingImagesSchema", () => {
  const validPayload = {
    photos: [
      { imageId: "image-1", focalX: 0.25, focalY: 0.75 },
      { uploadIntentId: "intent-2", focalX: null, focalY: null },
    ],
    basePhotoRevision: 3,
    mutationId: "mutation-123",
  };

  it("accepts a real ordered photo mutation payload", () => {
    expect(syncListingImagesSchema.safeParse(validPayload)).toMatchObject({
      success: true,
    });
  });

  it.each([
    ["both image IDs", { ...validPayload, photos: [{ imageId: "image-1", uploadIntentId: "intent-1" }] }],
    ["neither image ID", { ...validPayload, photos: [{ focalX: 0.5, focalY: 0.5 }] }],
    ["half a focal pair", { ...validPayload, photos: [{ imageId: "image-1", focalX: 0.5 }] }],
    ["half a null focal pair", { ...validPayload, photos: [{ imageId: "image-1", focalX: null }] }],
    [
      "an out-of-range focal point",
      { ...validPayload, photos: [{ imageId: "image-1", focalX: -0.1, focalY: 0.5 }] },
    ],
    [
      "more than the featured photo cap",
      {
        ...validPayload,
        photos: Array.from({ length: FEATURED_LISTING_PHOTO_LIMIT + 1 }, (_, index) => ({
          imageId: `image-${index}`,
        })),
      },
    ],
    ["unknown root keys", { ...validPayload, unexpected: true }],
    [
      "unknown photo keys",
      { ...validPayload, photos: [{ imageId: "image-1", unexpected: true }] },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(syncListingImagesSchema.safeParse(payload).success).toBe(false);
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

  it("requires a revision version when approving edits", () => {
    const result = moderateListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      action: "APPROVE_REVISION",
      expectedRevision: 2,
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

describe("public abuse safeguards POL-ABUSE-001", () => {
  it("rejects contact-seller honeypot submissions", () => {
    const result = contactSellerSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Buyer",
      email: "buyer@example.com",
      message: "Is this vehicle still available today?",
      website: "https://spam.example",
    });
    expect(result.success).toBe(false);
  });

  it("requires a coded report reason and enough detail", () => {
    expect(
      reportListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        reporterEmail: "buyer@example.com",
        reasonCode: "FRAUD",
        reason: "This listing appears to be a scam with fake photos",
      }).success,
    ).toBe(true);
    expect(
      reportListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        reporterEmail: "buyer@example.com",
        reasonCode: "FRAUD",
        reason: "Bad",
      }).success,
    ).toBe(false);
  });
});
