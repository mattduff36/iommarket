import { describe, expect, it } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import {
  getRippleProductByLinkCode,
  getRippleProductByPackageName,
  resolveRippleProduct,
} from "@/lib/payments/ripple-mapping";

describe("RIP-MAP-001 Ripple product mapping", () => {
  it("maps all four link codes exactly", () => {
    expect(getRippleProductByLinkCode(RIPPLE_CANONICAL_PRODUCTS.listing.code)?.key).toBe(
      "listing"
    );
    expect(getRippleProductByLinkCode(RIPPLE_CANONICAL_PRODUCTS.featured.code)?.key).toBe(
      "featured"
    );
    expect(getRippleProductByLinkCode(RIPPLE_CANONICAL_PRODUCTS.starter.code)?.key).toBe(
      "starter"
    );
    expect(getRippleProductByLinkCode(RIPPLE_CANONICAL_PRODUCTS.pro.code)?.key).toBe("pro");
  });

  it("maps approved package aliases and fails closed on unknowns", () => {
    expect(getRippleProductByPackageName("Dealer Pro")?.key).toBe("pro");
    expect(getRippleProductByPackageName("Dealer Starter subscription")?.key).toBe(
      "starter"
    );
    expect(resolveRippleProduct({ packageName: "Gold Monthly" })).toBeNull();
    expect(getRippleProductByLinkCode("NOT-A-REAL-CODE")).toBeNull();
    expect(
      resolveRippleProduct({
        linkCode: "NOT-A-REAL-CODE",
        packageName: "Dealer Pro",
      }),
    ).toBeNull();
  });
});
