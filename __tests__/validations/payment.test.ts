import { describe, it, expect } from "vitest";
import {
  createCheckoutSchema,
  createDealerSubscriptionSchema,
  payForListingSchema,
} from "@/lib/validations/payment";

describe("createCheckoutSchema", () => {
  it("accepts valid listing ID", () => {
    const result = createCheckoutSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty listing ID", () => {
    const result = createCheckoutSchema.safeParse({ listingId: "" });
    expect(result.success).toBe(false);
  });
});

describe("createDealerSubscriptionSchema POL-ACC-001-A", () => {
  it("accepts a valid acknowledgement", () => {
    const result = createDealerSubscriptionSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      acceptedDealerTerms: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing or false dealer acknowledgement", () => {
    expect(
      createDealerSubscriptionSchema.safeParse({
        dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      }).success,
    ).toBe(false);
    expect(
      createDealerSubscriptionSchema.safeParse({
        dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        acceptedDealerTerms: false,
      }).success,
    ).toBe(false);
  });
});

describe("payForListingSchema POL-PAY-001", () => {
  it("accepts a listing ID without a support option", () => {
    const result = payForListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
    expect(
      payForListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        privateSellerTermsAccepted: true,
      }).success,
    ).toBe(true);
  });

  it("rejects new support-payment fields", () => {
    expect(
      payForListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        supportPlatform: true,
      }).success,
    ).toBe(false);
    expect(
      payForListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        supportAmountPence: 600,
      }).success,
    ).toBe(false);
    expect(
      payForListingSchema.safeParse({
        listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        privateSellerTermsAccepted: false,
      }).success,
    ).toBe(false);
  });
});
