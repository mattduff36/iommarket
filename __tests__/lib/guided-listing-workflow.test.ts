import { describe, expect, it } from "vitest";
import {
  GUIDED_LISTING_STEPS,
  attributeStepMap,
  buildOptionalDetailSections,
  guidedCardStatus,
  guidedNavigationBlock,
  guidedStepForFieldErrors,
  partitionGuidedAttributeFields,
  splitGuidedAttributeErrors,
  validateAdvertFields,
} from "@/lib/listings/guided-listing-workflow";

const carFields = [
  { attr: { id: "make", slug: "make", required: true } },
  { attr: { id: "mileage", slug: "mileage", required: false } },
  { attr: { id: "write", slug: "write-off-category", required: false } },
  { attr: { id: "fuel", slug: "fuel-type", required: false } },
  { attr: { id: "engine", slug: "engine-size", required: false } },
  { attr: { id: "berths", slug: "sleeping-berths", required: false } },
  { attr: { id: "custom", slug: "custom-extra", required: false } },
];

describe("guided listing workflow", () => {
  it("keeps the approved five-step order", () => {
    expect(GUIDED_LISTING_STEPS.map((step) => step.description)).toEqual([
      "Required vehicle details",
      "Optional vehicle details",
      "Photos",
      "Advert",
      "Review",
    ]);
  });

  it("puts policy-required fields on required and leaves optional fields off that step", () => {
    const partitioned = partitionGuidedAttributeFields("car", carFields, true);
    expect(partitioned.required.map((field) => field.attr.slug)).toEqual([
      "make",
      "mileage",
      "write-off-category",
    ]);
    expect(partitioned.optional.map((field) => field.attr.slug)).toEqual([
      "fuel-type",
      "engine-size",
      "sleeping-berths",
      "custom-extra",
    ]);
  });

  it("keeps motorhome groups and does not drop an unknown optional field", () => {
    const sections = buildOptionalDetailSections(
      "motorhome",
      [
        { attr: { id: "fuel", slug: "fuel-type", required: false } },
        { attr: { id: "berths", slug: "sleeping-berths", required: false } },
        { attr: { id: "custom", slug: "custom-extra", required: false } },
      ],
      (field) => field.attr.slug,
    );
    expect(sections.map((section) => section.id)).toContain("habitation");
    expect(sections.find((section) => section.id === "habitation")?.items.map((item) => item.attr.slug)).toEqual([
      "sleeping-berths",
    ]);
    expect(sections.find((section) => section.id === "more")?.items.map((item) => item.attr.slug)).toEqual([
      "custom-extra",
    ]);
  });

  it("maps server fields onto the step that owns them", () => {
    const steps = attributeStepMap(
      [
        { id: "write", slug: "write-off-category", required: false },
        { id: "fuel", slug: "fuel-type", required: false },
      ],
      "car",
      true,
    );
    expect(
      guidedStepForFieldErrors(
        {
          title: ["Title must be at least 5 characters"],
          "attr-fuel": ["Choose a fuel type."],
          "attr-write": ["Insurance write-off category is required."],
        },
        { attributeSteps: steps, fallback: 1 },
      ),
    ).toBe(1);
    expect(
      guidedStepForFieldErrors(
        { title: ["Title must be at least 5 characters"] },
        { fallback: 1 },
      ),
    ).toBe(4);
    expect(
      guidedStepForFieldErrors(
        { privateSellerTermsAccepted: ["Private seller terms acceptance is required."] },
        { fallback: 5 },
      ),
    ).toBe(5);
    expect(
      guidedStepForFieldErrors({ attributes: ["Review the listing details."] }, { fallback: 1 }),
    ).toBe(1);
  });

  it("splits required and optional attribute errors without treating an empty optional as an error", () => {
    const split = splitGuidedAttributeErrors(
      {
        categoryId: ["Please choose a category."],
        "attr-write": ["Insurance write-off category is required."],
        "attr-engine": ["Engine Size must be a valid number."],
      },
      [
        { id: "write", slug: "write-off-category", required: false },
        { id: "engine", slug: "engine-size", required: false },
      ],
      "car",
      true,
    );
    expect(split.required["attr-write"]).toBeTruthy();
    expect(split.optional["attr-engine"]).toBeTruthy();
    expect(split.required["attr-engine"]).toBeUndefined();
  });

  it("lets optional be skipped and blocks busy uploads, incomplete photos, and incomplete adverts", () => {
    expect(
      guidedNavigationBlock({
        from: 2,
        to: 3,
        photoUploadsBusy: false,
        requiredComplete: true,
        optionalValid: true,
        photosComplete: false,
        advertComplete: false,
      }),
    ).toBeNull();
    expect(
      guidedNavigationBlock({
        from: 3,
        to: 4,
        photoUploadsBusy: true,
        requiredComplete: true,
        optionalValid: true,
        photosComplete: false,
        advertComplete: false,
      })?.message,
    ).toMatch(/photo uploads/i);
    expect(
      guidedNavigationBlock({
        from: 3,
        to: 5,
        photoUploadsBusy: false,
        requiredComplete: true,
        optionalValid: true,
        photosComplete: false,
        advertComplete: true,
      })?.step,
    ).toBe(3);
    expect(
      guidedNavigationBlock({
        from: 5,
        to: 1,
        photoUploadsBusy: false,
        requiredComplete: false,
        optionalValid: true,
        photosComplete: true,
        advertComplete: true,
      }),
    ).toBeNull();
  });

  it("rejects an empty advert and does not invent a description", () => {
    const result = validateAdvertFields({
      title: "BMW",
      description: "",
      price: "",
      regionId: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.description?.[0]).toMatch(/20 characters/);
      expect(result.fieldErrors.description?.[0]).not.toMatch(/well-kept/i);
    }
  });

  it("marks completion from validity rather than the open step alone", () => {
    expect(
      guidedCardStatus({ step: 2, current: 1, complete: true, attention: false }),
    ).toBe("complete");
    expect(
      guidedCardStatus({ step: 1, current: 1, complete: true, attention: true }),
    ).toBe("attention");
    expect(
      guidedCardStatus({ step: 4, current: 1, complete: false, attention: false }),
    ).toBe("pending");
  });
});
