import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.unstubAllEnvs());
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

  it.each(["payment.received", "payment.succeeded"] as const)("grants seven days for a weekly test %s on preview", async (type) => {
    const code = "ABCDEF0123456789";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    await processProviderWebhookEvent(renewalEvent({ type, amount: 100, linkCode: code, providerPlanId: code }));
    expect(subscriptionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      providerPlanId: code,
      currentPeriodEnd: new Date("2026-09-22T10:15:27.000Z"),
    }) }));
    expect(subscriptionChargeCreate).toHaveBeenCalled();
  });

  it("does not fulfil a weekly test payment in production", async () => {
    const code = "ABCDEF0123456789";
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    await expect(processProviderWebhookEvent(renewalEvent({ amount: 100, linkCode: code, providerPlanId: code }))).rejects.toThrow("Unknown Ripple product");
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("renews an existing weekly subscription after new preview checkouts are retired", async () => {
    const code = "ABCDEF0123456789";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    const existing = {
      id: "sub-1", dealerId: "dealer-1", providerPlanId: code,
      providerSubscriptionId: "synthetic-weekly", status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-07T02:34:14.408Z"),
      lastProviderEventAt: new Date("2026-09-30T02:34:14.408Z"),
      lastProviderEventType: "payment.succeeded", lastProviderEventFingerprint: "first-charge",
    };
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue({ ...existing, currentPeriodEnd: new Date("2026-10-14T02:34:14.408Z") });
    await processProviderWebhookEvent(renewalEvent({
      amount: 100, linkCode: code, providerPlanId: code, providerPaymentId: "weekly-second-charge",
      eventTimestamp: new Date("2026-10-07T02:34:14.408Z"), fingerprint: "second-charge",
    }));
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sub-1" },
      data: expect.objectContaining({ status: "ACTIVE", currentPeriodEnd: new Date("2026-10-14T02:34:14.408Z") }),
    }));
    expect(subscriptionChargeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ subscriptionId: "sub-1", paymentReference: "weekly-second-charge", amount: 100 })],
    }));
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

  it("AUD-LIFE-001b does not restore DEALER after admin demotion on ACTIVE renewal", async () => {
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
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue({
      ...existing,
      lastProviderEventFingerprint: "renewal-fingerprint",
    });
    (
      db.dealerProfile as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue({
      userId: "user-1",
      user: { role: "USER" },
    });

    await processProviderWebhookEvent(
      renewalEvent({
        fingerprint: "demotion-renewal-fingerprint",
        eventTimestamp: new Date("2026-10-15T10:15:27.000Z"),
      }),
    );

    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("AUD-LIFE-001b still grants DEALER on explicit first activation", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    (
      db.dealerProfile as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue({
      userId: "user-1",
      user: { role: "USER" },
    });

    await processProviderWebhookEvent(renewalEvent());

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "DEALER" },
    });
  });
});
