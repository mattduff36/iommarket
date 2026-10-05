import { beforeEach, describe, expect, it } from "vitest";
import {
  getPaymentProviderCapabilities,
  IN_APP_REFUND_PREREQUISITES,
  isOptionalSupportCheckoutConfigured,
} from "@/lib/payments/provider";

describe("provider config", () => {
  beforeEach(() => {
    delete process.env.RIPPLE_LISTING_SUPPORT_URL;
  });

  it("treats optional support checkout as disabled when no real URL is configured", () => {
    expect(isOptionalSupportCheckoutConfigured()).toBe(false);
  });

  it("keeps optional support checkout disabled until a fifth mapped link exists", () => {
    process.env.RIPPLE_LISTING_SUPPORT_URL = "https://portal.startyourripple.co.uk/pay/support";

    expect(isOptionalSupportCheckoutConfigured()).toBe(false);
  });

  it("keeps in-app refunds disabled until the claim gap is closed", () => {
    expect(IN_APP_REFUND_PREREQUISITES).toEqual([
      "claim-without-refunded-at-skips-provider-and-records-locally",
    ]);
    expect(getPaymentProviderCapabilities().supportsInAppRefunds).toBe(false);
  });
});
