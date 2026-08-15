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

  it("maps documented cancel-at-period-end aliases without inventing a refund reason", () => {
    const event = normalizeProviderWebhookEvent({
      type: "subscription.updated",
      data: {
        subscription_id: "sub_123",
        cancel_at_period_end: "true",
        current_period_end: "2026-09-01T00:00:00.000Z",
        status: "ACTIVE",
      },
    });

    expect(event.type).toBe("subscription.updated");
    expect(event.providerSubscriptionId).toBe("sub_123");
    expect(event.cancelAtPeriodEnd).toBe(true);
    expect(event.currentPeriodEnd).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });
});
