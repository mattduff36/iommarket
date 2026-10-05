import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

import { handleRefundedPayment } from "@/lib/payments/webhook-payments";

function refundEvent(): NormalizedProviderWebhookEvent {
  return {
    id: "refund-event-1",
    type: "payment.refunded",
    rawType: "payment.refunded",
    providerPaymentId: "provider-payment-new",
    providerReference: "merchant-reference-1",
    providerSubscriptionId: null,
    providerPlanId: null,
    paymentStatus: "REFUNDED",
    subscriptionStatus: null,
    amount: 500,
    currency: "gbp",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventTimestamp: new Date("2026-10-05T12:00:00.000Z"),
    clientId: "client",
    customerEmail: null,
    linkCode: null,
    packageName: null,
    recurring: false,
    linkType: "one-off",
    fingerprint: "refund-fingerprint",
    metadata: {
      checkoutType: "featured_upgrade",
      listingId: "listing-1",
      dealerId: null,
      tier: null,
    },
    payload: {},
  };
}

describe("listing refund correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a mismatched provider payment ID even when the merchant reference matches", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "payment-1",
        providerPaymentId: "provider-payment-old",
        providerReference: "merchant-reference-1",
        status: "SUCCEEDED",
        refundedAt: null,
        refundReason: null,
      },
    ]);

    await expect(handleRefundedPayment(refundEvent())).rejects.toThrow(
      "subscription charge collision",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("treats an exact refunded replay as an idempotent no-op", async () => {
    const payment = {
      id: "payment-1",
      providerPaymentId: "provider-payment-new",
      providerReference: "merchant-reference-1",
      status: "REFUNDED",
      refundedAt: new Date("2026-10-05T12:00:00.000Z"),
      refundReason: null,
    };
    mocks.findMany.mockResolvedValue([payment]);

    await expect(handleRefundedPayment(refundEvent())).resolves.toBe(payment);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
