import { describe, expect, it } from "vitest";
import { isPaidSubscriptionRecord } from "@/lib/payments/records";

describe("subscription revenue classification", () => {
  it("excludes free admin grants from paid subscription reporting", () => {
    expect(isPaidSubscriptionRecord({ source: "ADMIN_GRANT" })).toBe(false);
    expect(isPaidSubscriptionRecord({ source: "PAYMENT" })).toBe(true);
  });
});
