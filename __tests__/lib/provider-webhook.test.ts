import { describe, expect, it } from "vitest";
import { normalizeProviderWebhookEvent } from "@/lib/payments/provider";

describe("provider webhook normalization", () => {
  it("infers successful payment events from the raw envelope type", () => {
    const event = normalizeProviderWebhookEvent({
      type: "payment.succeeded",
      data: {
        paymentId: "pay_123",
      },
    });

    expect(event.type).toBe("payment.succeeded");
  });

  it("infers failed payment events from the raw envelope type", () => {
    const event = normalizeProviderWebhookEvent({
      type: "payment.failed",
      data: {
        paymentId: "pay_456",
      },
    });

    expect(event.type).toBe("payment.failed");
  });
});
