import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  subscriptionFindFirst,
  subscriptionCreate,
  subscriptionUpdate,
  subscriptionFindMany,
  userFindMany,
  userUpdate,
  dealerProfileUpdate,
  subscriptionChargeCreate,
  subscriptionChargeFindUnique,
  transactionMock,
  db,
} = vi.hoisted(() => {
  const subscriptionFindFirst = vi.fn();
  const subscriptionCreate = vi.fn();
  const subscriptionUpdate = vi.fn();
  const subscriptionFindMany = vi.fn();
  const userFindMany = vi.fn();
  const userUpdate = vi.fn();
  const dealerProfileUpdate = vi.fn();
  const subscriptionChargeCreate = vi.fn();
  const subscriptionChargeFindUnique = vi.fn();
  const transactionMock = vi.fn();
  const db: Record<string, unknown> = {
    subscription: {
      findFirst: subscriptionFindFirst,
      findUnique: vi.fn().mockResolvedValue(null),
      create: subscriptionCreate,
      findMany: subscriptionFindMany,
      update: subscriptionUpdate,
    },
    dealerCancellationRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    subscriptionCharge: {
      create: subscriptionChargeCreate,
      createMany: subscriptionChargeCreate,
      findUnique: subscriptionChargeFindUnique,
    },
    user: {
      findMany: userFindMany,
      update: userUpdate,
    },
    dealerProfile: {
      findUnique: vi.fn(),
      update: dealerProfileUpdate,
    },
  };
  db.$transaction = transactionMock;
  return {
    subscriptionFindFirst,
    subscriptionCreate,
    subscriptionUpdate,
    subscriptionFindMany,
    userFindMany,
    userUpdate,
    dealerProfileUpdate,
    subscriptionChargeCreate,
    subscriptionChargeFindUnique,
    transactionMock,
    db,
  };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
}));

import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";

function renewalEvent(
  overrides: Partial<NormalizedProviderWebhookEvent> = {}
): NormalizedProviderWebhookEvent {
  return {
    id: "evt-renewal",
    type: "payment.succeeded",
    rawType: "payment.success",
    providerPaymentId: "pay-renew-1",
    providerReference: null,
    providerSubscriptionId: null,
    providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
    paymentStatus: "SUCCEEDED",
    subscriptionStatus: null,
    amount: 4999,
    currency: "gbp",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventTimestamp: new Date("2026-09-15T10:15:27.000Z"),
    clientId: "codelabplatfdcf3a8",
    customerEmail: "cardholder@example.com",
    linkCode: null,
    packageName: "Dealer Pro",
    recurring: true,
    linkType: null,
    fingerprint: "renewal-fingerprint",
    metadata: {
      checkoutType: "dealer_subscription",
      listingId: null,
      dealerId: null,
      tier: "PRO",
    },
    payload: {},
    ...overrides,
  };
}

describe("RIP-PRICE-001 / RIP-CORR-001 dealer fulfillment", () => {
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    subscriptionFindMany.mockResolvedValue([]);
    subscriptionChargeCreate.mockResolvedValue({ count: 1 });
    subscriptionChargeFindUnique.mockResolvedValue(null);
    subscriptionCreate.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      status: "ACTIVE",
    });
  });

  it("matches a renewal to the stored payer email when it differs from the account email", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    await processProviderWebhookEvent(renewalEvent());
    expect(subscriptionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerEmailNorm: "cardholder@example.com",
          providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        }),
      })
    );
    expect(userFindMany).not.toHaveBeenCalled();
    expect(subscriptionCreate).toHaveBeenCalled();
    expect(subscriptionChargeCreate).toHaveBeenCalled();
  });

  it("fails closed when one payer email matches more than one dealer", async () => {
    subscriptionFindMany.mockResolvedValueOnce([
      { dealerId: "dealer-1" },
      { dealerId: "dealer-2" },
    ]);
    await expect(processProviderWebhookEvent(renewalEvent())).rejects.toThrow(
      "Ambiguous dealer email correlation"
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects dealer amount drift", async () => {
    await expect(
      processProviderWebhookEvent(renewalEvent({ amount: 1 }))
    ).rejects.toThrow("amount must be 4999 pence");
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("rolls back a later fingerprint that reuses a payment reference RIP-CHARGE-001", async () => {
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerSubscriptionId: "synthetic-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-15T10:15:27.000Z"),
      lastProviderEventType: "payment.succeeded",
      lastProviderEventFingerprint: "older-fingerprint",
    };
    subscriptionFindMany
      .mockResolvedValueOnce([{ dealerId: "dealer-1" }])
      .mockResolvedValueOnce([
        {
          ...existing,
          currentPeriodEnd: new Date("2026-11-15T10:15:27.000Z"),
        },
      ]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue({
      ...existing,
      currentPeriodEnd: new Date("2026-11-15T10:15:27.000Z"),
      lastProviderEventFingerprint: "later-fingerprint",
    });
    subscriptionChargeCreate.mockResolvedValueOnce({ count: 0 });
    subscriptionChargeFindUnique.mockResolvedValueOnce({
      subscriptionId: "sub-1",
      amount: 4999,
      currency: "gbp",
    });
    let rolledBack = false;
    transactionMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      try {
        return await fn(db);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          fingerprint: "later-fingerprint",
          eventTimestamp: new Date("2026-10-15T10:15:27.000Z"),
        }),
      ),
    ).resolves.toBeUndefined();

    expect(subscriptionChargeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(rolledBack).toBe(true);
  });

  it("rejects a cross-subscription charge collision RIP-CHARGE-002", async () => {
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerSubscriptionId: "synthetic-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-15T10:15:27.000Z"),
      lastProviderEventType: "payment.succeeded",
      lastProviderEventFingerprint: "older-fingerprint",
    };
    subscriptionFindMany
      .mockResolvedValueOnce([{ dealerId: "dealer-1" }])
      .mockResolvedValueOnce([existing]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue(existing);
    subscriptionChargeCreate.mockResolvedValueOnce({ count: 0 });
    subscriptionChargeFindUnique.mockResolvedValueOnce({
      subscriptionId: "different-subscription",
      amount: 2999,
      currency: "gbp",
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          fingerprint: "collision-fingerprint",
          eventTimestamp: new Date("2026-10-15T10:15:27.000Z"),
        }),
      ),
    ).rejects.toThrow("subscription charge collision");
  });
});
