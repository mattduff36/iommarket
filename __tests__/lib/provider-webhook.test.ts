import { beforeEach, describe, expect, it } from "vitest";
import { normalizeProviderWebhookEvent } from "@/lib/payments/provider";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { installRippleTestEnv, rippleEnvelope } from "./ripple-test-env";

describe("provider webhook normalization", () => {
  beforeEach(() => {
    installRippleTestEnv();
  });

  it("maps payment.received from the verified Ripple envelope", () => {
    const event = normalizeProviderWebhookEvent(rippleEnvelope());
    expect(event.type).toBe("payment.received");
    expect(event.linkCode).toBe(RIPPLE_CANONICAL_PRODUCTS.listing.code);
  });

  it("maps payment.failed from the verified Ripple envelope", () => {
    const event = normalizeProviderWebhookEvent(
      rippleEnvelope({ event: "payment.failed" })
    );
    expect(event.type).toBe("payment.failed");
  });

  it("maps subscription cancellation without inventing a refund reason", () => {
    const event = normalizeProviderWebhookEvent(
      rippleEnvelope({
        event: "subscription.cancelled",
        data: {
          amount: 49,
          package: "Dealer Pro",
        },
      })
    );
    expect(event.type).toBe("subscription.cancelled");
    expect(event.packageName).toBe("Dealer Pro");
  });
});
