import { beforeEach, describe, expect, it } from "vitest";
import { isOptionalSupportCheckoutConfigured } from "@/lib/payments/provider";

describe("provider config", () => {
  beforeEach(() => {
    delete process.env.RIPPLE_LISTING_SUPPORT_URL;
  });

  it("treats optional support checkout as disabled when no real URL is configured", () => {
    expect(isOptionalSupportCheckoutConfigured()).toBe(false);
  });

  it("treats optional support checkout as enabled when a real URL is configured", () => {
    process.env.RIPPLE_LISTING_SUPPORT_URL = "https://portal.startyourripple.co.uk/pay/support";

    expect(isOptionalSupportCheckoutConfigured()).toBe(true);
  });
});
