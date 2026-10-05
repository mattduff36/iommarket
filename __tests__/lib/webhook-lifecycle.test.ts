import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  paymentFindMany,
  paymentUpdate,
  subscriptionFindFirst,
  subscriptionFindUnique,
  subscriptionFindMany,
  subscriptionUpdate,
  dealerProfileUpdate,
  subscriptionChargeFindUnique,
  subscriptionChargeUpdateMany,
  executeRaw,
  captureBusinessEvent,
} = vi.hoisted(() => ({
  paymentFindMany: vi.fn(),
  paymentUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionUpdate: vi.fn(),
  dealerProfileUpdate: vi.fn(),
  subscriptionChargeFindUnique: vi.fn(),
  subscriptionChargeUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  captureBusinessEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const client = {
    payment: {
      findMany: paymentFindMany,
      update: paymentUpdate,
    },
    subscription: {
      findFirst: subscriptionFindFirst,
      findUnique: subscriptionFindUnique,
      findMany: subscriptionFindMany,
      update: subscriptionUpdate,
    },
    dealerProfile: {
      update: dealerProfileUpdate,
    },
    subscriptionCharge: {
      findUnique: subscriptionChargeFindUnique,
      updateMany: subscriptionChargeUpdateMany,
    },
    dealerCancellationRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: executeRaw,
  };
  return {
    db: {
      ...client,
      $transaction: vi.fn(
        async (operation: (tx: typeof client) => unknown) => operation(client),
      ),
    },
  };
});

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
    eventTimestamp: new Date("2026-08-15T10:00:00.000Z"),
    clientId: "codelabplatfdcf3a8",
    customerEmail: null,
    linkCode: null,
    packageName: null,
    recurring: false,
    linkType: "one-off",
    fingerprint: "evt-1",
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
    subscriptionChargeFindUnique.mockResolvedValue(null);
    subscriptionFindUnique.mockResolvedValue(null);
    subscriptionFindMany.mockResolvedValue([]);
  });

  it("marks matching payments refunded with a retained reason", async () => {
    paymentFindMany.mockResolvedValue([
      {
        id: "local-pay",
        providerPaymentId: "pay_1",
        providerReference: "ref_1",
        status: "SUCCEEDED",
        refundedAt: null,
        refundReason: "FRAUD",
      },
    ]);

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
    paymentFindMany.mockResolvedValue([]);
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

  it("ends entitlement after a parsed refund with no provider period end", async () => {
    paymentFindMany.mockResolvedValue([]);
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      refundedAt: null,
      eventTimestamp: new Date("2026-08-15T10:00:00.000Z"),
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: "C5D44F6F18094B94",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-09-15T10:00:00.000Z"),
      charges: [
        {
          id: "charge-1",
          eventTimestamp: new Date("2026-08-15T10:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });

    await processProviderWebhookEvent(
      baseEvent({
        type: "payment.refunded",
        amount: 4999,
        currency: "gbp",
        providerSubscriptionId: "prov-sub",
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        metadata: {
          checkoutType: null,
          listingId: null,
          dealerId: null,
          tier: null,
        },
      }),
    );

    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      subscriptionChargeUpdateMany.mock.invocationCallOrder[0],
    );
    const [statement, key] = executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(statement.join("")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(key).toBe("pay_1");
    expect(subscriptionChargeUpdateMany).toHaveBeenCalledWith({
      where: { id: "charge-1", refundedAt: null },
      data: {
        refundedAt: new Date("2026-08-15T10:00:00.000Z"),
        refundEventId: "evt-1",
      },
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: {
        status: "CANCELLED",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
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
