import { beforeEach, describe, expect, it } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import {
  createRippleReference,
  parseRippleReference,
} from "@/lib/payments/ripple-reference";
import { installRippleTestEnv } from "./ripple-test-env";

describe("RIP-REF-001 Ripple signed references", () => {
  beforeEach(() => {
    installRippleTestEnv();
  });

  it("round-trips a listing reference", () => {
    const value = createRippleReference({
      purpose: "listing_payment",
      targetId: "listing-99",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    });
    expect(
      parseRippleReference(value, RIPPLE_CANONICAL_PRODUCTS.listing.code)
    ).toMatchObject({
      purpose: "listing_payment",
      targetId: "listing-99",
    });
  });

  it("fails closed on target, purpose, link-code, version, and MAC tampering", () => {
    const value = createRippleReference({
      purpose: "featured_upgrade",
      targetId: "listing-99",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.featured.code,
    });
    const [version, purpose, target, nonce, mac] = value.split(":");

    expect(() =>
      parseRippleReference(
        ["v2", purpose, target, nonce, mac].join(":"),
        RIPPLE_CANONICAL_PRODUCTS.featured.code
      )
    ).toThrow("Invalid Ripple reference");
    expect(() =>
      parseRippleReference(
        [version, "listing_payment", target, nonce, mac].join(":"),
        RIPPLE_CANONICAL_PRODUCTS.featured.code
      )
    ).toThrow("Invalid Ripple reference");
    expect(() =>
      parseRippleReference(
        [version, purpose, "other-listing", nonce, mac].join(":"),
        RIPPLE_CANONICAL_PRODUCTS.featured.code
      )
    ).toThrow("Invalid Ripple reference");
    expect(() =>
      parseRippleReference(value, RIPPLE_CANONICAL_PRODUCTS.listing.code)
    ).toThrow("Invalid Ripple reference");
    expect(() =>
      parseRippleReference(
        [version, purpose, target, nonce, "0".repeat(32)].join(":"),
        RIPPLE_CANONICAL_PRODUCTS.featured.code
      )
    ).toThrow("Invalid Ripple reference");
  });
});
