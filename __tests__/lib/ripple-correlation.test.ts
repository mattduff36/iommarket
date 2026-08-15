import { beforeEach, describe, expect, it } from "vitest";
import {
  createSyntheticSubscriptionId,
  listSyntheticSubscriptionIds,
  normalizeRippleEmail,
} from "@/lib/payments/ripple-reference";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { installRippleTestEnv, RIPPLE_TEST_CLIENT_ID } from "./ripple-test-env";

describe("RIP-CORR-001 dealer correlation helpers", () => {
  beforeEach(() => {
    installRippleTestEnv();
  });

  it("normalizes email case and versions synthetic subscription ids", () => {
    expect(normalizeRippleEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    const current = createSyntheticSubscriptionId({
      clientId: RIPPLE_TEST_CLIENT_ID,
      linkCode: RIPPLE_CANONICAL_PRODUCTS.starter.code,
      email: "Buyer@Example.COM",
    });
    process.env.RIPPLE_REFERENCE_SECRET_PREVIOUS = process.env.RIPPLE_REFERENCE_SECRET;
    process.env.RIPPLE_REFERENCE_SECRET = `${process.env.RIPPLE_REFERENCE_SECRET}-rotated`;
    const ids = listSyntheticSubscriptionIds({
      clientId: RIPPLE_TEST_CLIENT_ID,
      linkCode: RIPPLE_CANONICAL_PRODUCTS.starter.code,
      email: "buyer@example.com",
    });
    expect(ids).toContain(current);
    expect(ids).toHaveLength(2);
  });
});
