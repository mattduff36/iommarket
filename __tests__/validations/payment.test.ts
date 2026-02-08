import { describe, it, expect } from "vitest";
import {
  createCheckoutSchema,
  createDealerSubscriptionSchema,
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
