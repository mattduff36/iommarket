import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  paymentFindFirst,
  paymentUpdate,
  subscriptionFindFirst,
  subscriptionUpdate,
  captureBusinessEvent,
} = vi.hoisted(() => ({
  paymentFindFirst: vi.fn(),
  paymentUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  subscriptionUpdate: vi.fn(),
  captureBusinessEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findFirst: paymentFindFirst,
      update: paymentUpdate,
    },
    subscription: {
      findFirst: subscriptionFindFirst,
      update: subscriptionUpdate,
    },
  },
}));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent,
}));

import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider";

function baseEvent(
  overrides: Partial<NormalizedProviderWebhookEvent>,
): NormalizedProviderWebhookEvent {
  return {
    id: "evt-1",
    type: "payment.refunded",
    rawType: "payment.refunded",
    providerPaymentId: "pay_1",
    providerReference: "ref_1",
    providerSubscriptionId: null,
    providerPlanId: null,
    paymentStatus: "REFUNDED",
    subscriptionStatus: null,
    amount: 1000,
    currency: "GBP",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    metadata: {
      checkoutType: "listing_payment",
      listingId: "listing-1",
      dealerId: null,
      tier: null,
    },
    payload: {},
    ...overrides,
  };
}

describe("payment webhook reconciliation ALR-PAY-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks matching payments refunded with a retained reason", async () => {
    paymentFindFirst.mockResolvedValue({
      id: "local-pay",
      refundReason: "FRAUD",
    });

    await processProviderWebhookEvent(baseEvent({ type: "payment.refunded" }));

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "local-pay" },
      data: expect.objectContaining({
        status: "REFUNDED",
        refundReason: "FRAUD",
      }),
    });
  });

  it("is idempotent when the refund webhook has no local payment", async () => {
    paymentFindFirst.mockResolvedValue(null);
    subscriptionFindFirst.mockResolvedValue(null);
    await processProviderWebhookEvent(baseEvent({ type: "payment.refunded" }));
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(captureBusinessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Refund webhook with no matching payment",
      }),
    );
  });

  it("schedules entitlement end for unmatched subscription refunds", async () => {
    paymentFindFirst.mockResolvedValue(null);
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });

    await processProviderWebhookEvent(
      baseEvent({
        type: "payment.refunded",
        providerSubscriptionId: "prov-sub",
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        metadata: {
          checkoutType: "dealer_subscription",
          listingId: null,
          dealerId: "dealer-1",
          tier: "STARTER",
        },
      }),
    );

    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
  });

  it("clears cancel-at-period-end when the provider cancels", async () => {
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    await processProviderWebhookEvent(
      baseEvent({
        type: "subscription.cancelled",
        providerSubscriptionId: "prov-sub",
        subscriptionStatus: "CANCELLED",
      }),
    );
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "CANCELLED", cancelAtPeriodEnd: false },
    });
  });
});
