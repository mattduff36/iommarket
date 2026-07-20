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

describe("createDealerSubscriptionSchema", () => {
  it("accepts valid dealer ID", () => {
    const result = createDealerSubscriptionSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });
});

describe("payForListingSchema", () => {
  it("accepts an optional support selection without a client amount", () => {
    const result = payForListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      supportPlatform: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a client-submitted monetary support amount", () => {
    const result = payForListingSchema.safeParse({
      listingId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      supportAmountPence: 600,
    });
    expect(result.success).toBe(false);
  });
});
