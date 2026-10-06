import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPaidSubscriptionEntitled } from "@/lib/dealers/entitlement";
import { isRecognisedSubscriptionCharge } from "@/lib/payments/records";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { installRippleTestEnv, rippleEnvelope } from "./ripple-test-env";
import { createRippleReference } from "@/lib/payments/ripple-reference";

const {
  subscriptionFindFirst,
  subscriptionFindUnique,
  subscriptionCreate,
  subscriptionUpdate,
  subscriptionFindMany,
  userFindMany,
  userUpdate,
  dealerProfileUpdate,
  subscriptionChargeCreate,
  subscriptionChargeFindUnique,
  subscriptionChargeFindFirst,
  subscriptionChargeUpdate,
  transactionMock,
  db,
} = vi.hoisted(() => {
  const subscriptionFindFirst = vi.fn();
  const subscriptionFindUnique = vi.fn();
  const subscriptionCreate = vi.fn();
  const subscriptionUpdate = vi.fn();
  const subscriptionFindMany = vi.fn();
  const userFindMany = vi.fn();
  const userUpdate = vi.fn();
  const dealerProfileUpdate = vi.fn();
  const subscriptionChargeCreate = vi.fn();
  const subscriptionChargeFindUnique = vi.fn();
  const subscriptionChargeFindFirst = vi.fn();
  const subscriptionChargeUpdate = vi.fn();
  const transactionMock = vi.fn();
  const db: Record<string, unknown> = {
    subscription: {
      findFirst: subscriptionFindFirst,
      findUnique: subscriptionFindUnique,
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
      findFirst: subscriptionChargeFindFirst,
      update: subscriptionChargeUpdate,
      updateMany: vi.fn(),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    paymentWebhookInbox: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    paymentCheckoutAttempt: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    providerPaymentClaim: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    paymentReconciliation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
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
  db.$queryRaw = vi.fn();
  db.$executeRaw = vi.fn();
  return {
    subscriptionFindFirst,
    subscriptionFindUnique,
    subscriptionCreate,
    subscriptionUpdate,
    subscriptionFindMany,
    userFindMany,
    userUpdate,
    dealerProfileUpdate,
    subscriptionChargeCreate,
    subscriptionChargeFindUnique,
    subscriptionChargeFindFirst,
    subscriptionChargeUpdate,
    transactionMock,
    db,
  };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
}));

import { captureBusinessEvent } from "@/lib/monitoring";
import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";
import { lockProviderPayment } from "@/lib/payments/webhook-subscriptions";

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
  it("locks a provider payment with $executeRaw", async () => {
    await lockProviderPayment(db as never, "pay-lock-1");

    const executeRaw = db.$executeRaw as ReturnType<typeof vi.fn>;
    const [statement, key] = executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(statement.join("")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(statement.join("")).toContain(", 0)");
    expect(key).toBe("pay-lock-1");
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockReset();
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockReset();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    (
      db.paymentWebhookInbox as { findFirst: ReturnType<typeof vi.fn> }
    ).findFirst.mockReset().mockResolvedValue(null);
    subscriptionFindFirst.mockResolvedValue(null);
    subscriptionFindUnique.mockResolvedValue(null);
    subscriptionFindMany.mockResolvedValue([]);
    (
      db.providerPaymentClaim as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockReset().mockResolvedValue(null);
    (
      db.paymentReconciliation as { findFirst: ReturnType<typeof vi.fn> }
    ).findFirst.mockReset().mockResolvedValue(null);
    let insertedCharge: Record<string, unknown> | null = null;
    subscriptionChargeCreate.mockReset();
    subscriptionChargeFindUnique.mockReset();
    subscriptionChargeFindFirst.mockReset().mockResolvedValue(null);
    subscriptionChargeCreate.mockImplementation(({ data }) => {
      insertedCharge = data[0];
      return Promise.resolve({ count: 1 });
    });
    subscriptionChargeFindUnique.mockImplementation(() =>
      Promise.resolve(
        insertedCharge ? { id: "charge-1", ...insertedCharge } : null,
      ),
    );
    subscriptionCreate.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      status: "ACTIVE",
    });
    const paymentCheckoutAttempt = db.paymentCheckoutAttempt as {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    paymentCheckoutAttempt.findUnique.mockReset().mockResolvedValue(null);
    paymentCheckoutAttempt.findMany.mockImplementation(({ where }) => {
      const candidate = {
        id: "attempt-1",
        userId: "user-1",
        dealerId: "dealer-1",
        paymentId: null,
        listingId: null,
        kind: "DEALER_SUBSCRIPTION",
        status: "OPEN",
        merchantReference: createRippleReference({
          purpose: "dealer_subscription",
          targetId: "dealer-1",
          linkCode: where.productCode,
          tier: where.tier,
        }),
        productCode: where.productCode,
        tier: where.tier,
        amountPence: where.amountPence,
        currency: "gbp",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      };
      paymentCheckoutAttempt.findUnique.mockImplementation(({ where: unique }) =>
        Promise.resolve(unique.id === candidate.id ? candidate : null),
      );
      return Promise.resolve([candidate]);
    });
    (db.dealerProfile as { findUnique: ReturnType<typeof vi.fn> }).findUnique
      .mockResolvedValue({
        id: "dealer-1",
        userId: "user-1",
        user: { role: "USER", email: "dealer@example.com" },
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
    await expect(processProviderWebhookEvent(renewalEvent({
      amount: 100, linkCode: null, providerPlanId: null, packageName: "TEST SUBSCRIPTION LINK", fingerprint: "package-on-production",
    }))).rejects.toThrow("Unknown Ripple product");
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

  it("renews the weekly test when the webhook timestamp is the period end and no checkout exists", async () => {
    const code = "ABCDEF0123456789";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    const periodEnd = new Date("2026-10-07T01:34:14.408Z");
    const existing = {
      id: "sub-1", dealerId: "dealer-1", providerPlanId: code,
      providerSubscriptionId: "synthetic-weekly", status: "ACTIVE",
      currentPeriodEnd: periodEnd,
      lastProviderEventAt: new Date("2026-09-30T01:34:14.408Z"),
      lastProviderEventType: "payment.succeeded", lastProviderEventFingerprint: "first-charge",
    };
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionChargeFindFirst.mockResolvedValue({ id: "prior-charge" });
    (db.paymentCheckoutAttempt as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([]);
    subscriptionUpdate.mockResolvedValue({ ...existing, currentPeriodEnd: new Date("2026-10-14T01:34:14.408Z") });
    await processProviderWebhookEvent(renewalEvent({
      amount: 100, linkCode: code, providerPlanId: code, providerPaymentId: "weekly-second-charge",
      eventTimestamp: periodEnd, fingerprint: "second-charge", packageName: "TEST SUBSCRIPTION LINK",
    }));
    expect((db.paymentCheckoutAttempt as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sub-1" },
      data: expect.objectContaining({ status: "ACTIVE", currentPeriodEnd: new Date("2026-10-14T01:34:14.408Z") }),
    }));
    expect(subscriptionChargeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ subscriptionId: "sub-1", paymentReference: "weekly-second-charge", amount: 100 })],
    }));
  });

  it("recognises a linkless weekly renewal by package title on preview", async () => {
    const code = "ABCDEF0123456789";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    const periodEnd = new Date("2026-10-07T01:34:14.408Z");
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue({
      id: "sub-1", dealerId: "dealer-1", providerPlanId: code, status: "ACTIVE",
      currentPeriodEnd: periodEnd, lastProviderEventAt: new Date("2026-09-30T01:34:14.408Z"),
      lastProviderEventType: "payment.succeeded", lastProviderEventFingerprint: "first-charge",
    });
    subscriptionChargeFindFirst.mockResolvedValue({ id: "prior-charge" });
    subscriptionUpdate.mockResolvedValue({ id: "sub-1" });
    await processProviderWebhookEvent(renewalEvent({
      amount: 100, linkCode: null, providerPlanId: null, providerPaymentId: "weekly-package-renewal",
      eventTimestamp: periodEnd, fingerprint: "package-renewal", packageName: "TEST SUBSCRIPTION LINK",
    }));
    expect(subscriptionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerPlanId: code, currentPeriodEnd: new Date("2026-10-14T01:34:14.408Z") }),
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

  it("PAY-SUB-IDEM-007 treats a later fingerprint for an existing charge as a no-op", async () => {
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerSubscriptionId: "synthetic-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-11-15T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-15T10:15:27.000Z"),
      lastProviderEventType: "payment.succeeded",
      lastProviderEventFingerprint: "older-fingerprint",
    };
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      amount: 4999,
      currency: "gbp",
    });
    (
      db.providerPaymentClaim as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue({
      attemptId: null,
      subscriptionChargeId: "charge-1",
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          fingerprint: "later-fingerprint",
          eventTimestamp: new Date("2026-10-15T10:15:27.000Z"),
        }),
      ),
    ).resolves.toBeUndefined();

    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("records and fulfils an out-of-order verified charge without regressing lifecycle metadata", async () => {
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerSubscriptionId: "provider-sub-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "INCOMPLETE",
      currentPeriodEnd: null,
      lastProviderEventAt: new Date("2026-09-16T10:15:27.000Z"),
      lastProviderEventType: "subscription.created",
      lastProviderEventFingerprint: "newer-created-event",
    };
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue({
      ...existing,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
    });

    await processProviderWebhookEvent(renewalEvent());

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
      }),
    });
    expect(subscriptionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastProviderEventFingerprint: "renewal-fingerprint",
        }),
      }),
    );
    expect(subscriptionChargeCreate).toHaveBeenCalled();
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

  it("PAY-SUB-ATTEMPT-001 refuses an initial activation without a checkout attempt", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    (
      db.paymentCheckoutAttempt as { findMany: ReturnType<typeof vi.fn> }
    ).findMany.mockResolvedValueOnce([]);

    await expect(processProviderWebhookEvent(renewalEvent())).rejects.toThrow(
      "Initial subscription payment has no unique persisted checkout attempt",
    );

    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("PAY-SUB-ATTEMPT-004 refuses a lapsed subscription that has never recorded a charge", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-01T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-01T10:15:27.000Z"),
      lastProviderEventType: "subscription.created",
      lastProviderEventFingerprint: "created",
    });
    subscriptionChargeFindFirst.mockResolvedValue(null);
    (
      db.paymentCheckoutAttempt as { findMany: ReturnType<typeof vi.fn> }
    ).findMany.mockResolvedValueOnce([]);

    await expect(
      processProviderWebhookEvent(
        renewalEvent({ eventTimestamp: new Date("2026-10-10T10:15:27.000Z"), fingerprint: "late" }),
      ),
    ).rejects.toThrow("Initial subscription payment has no unique persisted checkout attempt");
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("PAY-SUB-ATTEMPT-002 permits a genuine entitled renewal without a new attempt", async () => {
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      providerSubscriptionId: "provider-sub-1",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-15T10:15:27.000Z"),
      lastProviderEventType: "payment.succeeded",
      lastProviderEventFingerprint: "older-fingerprint",
    };
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue(existing);

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          eventTimestamp: new Date("2026-10-10T10:15:27.000Z"),
          fingerprint: "new-renewal-fingerprint",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(subscriptionUpdate).toHaveBeenCalled();
    expect(subscriptionChargeCreate).toHaveBeenCalled();
    expect(
      (db.paymentCheckoutAttempt as { findMany: ReturnType<typeof vi.fn> })
        .findMany,
    ).not.toHaveBeenCalled();
  });

  it("PAY-SUB-ATTEMPT-003 rejects a signed attempt whose contract differs", async () => {
    const reference = createRippleReference({
      purpose: "dealer_subscription",
      targetId: "dealer-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "STARTER",
    });
    (
      db.paymentCheckoutAttempt as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue({
      id: "attempt-1",
      userId: "user-1",
      dealerId: "dealer-1",
      paymentId: null,
      listingId: null,
      kind: "DEALER_SUBSCRIPTION",
      status: "OPEN",
      merchantReference: reference,
      productCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
      amountPence: 4999,
      currency: "gbp",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          providerReference: reference,
          metadata: {
            checkoutType: "dealer_subscription",
            listingId: null,
            dealerId: "dealer-1",
            tier: "PRO",
          },
        }),
      ),
    ).rejects.toThrow("Subscription checkout attempt does not match payment");

    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("PAY-SUB-ATTEMPT-004 records the claim and reconciliation with fulfillment", async () => {
    const reference = createRippleReference({
      purpose: "dealer_subscription",
      targetId: "dealer-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
    });
    (
      db.paymentCheckoutAttempt as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue({
      id: "attempt-1",
      userId: "user-1",
      dealerId: "dealer-1",
      paymentId: null,
      listingId: null,
      kind: "DEALER_SUBSCRIPTION",
      status: "OPEN",
      merchantReference: reference,
      productCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
      amountPence: 4999,
      currency: "gbp",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    await processProviderWebhookEvent(
      renewalEvent({
        providerReference: reference,
        metadata: {
          checkoutType: "dealer_subscription",
          listingId: null,
          dealerId: "dealer-1",
          tier: "PRO",
        },
      }),
    );

    expect(
      (db.providerPaymentClaim as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptId: "attempt-1",
        subscriptionChargeId: "charge-1",
        providerPaymentId: "pay-renew-1",
        source: "VERIFIED_WEBHOOK",
      }),
    });
    expect(
      (db.paymentReconciliation as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptId: "attempt-1",
        providerPaymentId: "pay-renew-1",
        evidenceType: "VERIFIED_WEBHOOK",
      }),
    });
    expect(
      (db.paymentCheckoutAttempt as { update: ReturnType<typeof vi.fn> }).update,
    ).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({ status: "CONFIRMED" }),
    });
  });

  it("PAY-SUB-ATTEMPT-005 rejects an unknown supplied merchant reference", async () => {
    const reference = createRippleReference({
      purpose: "dealer_subscription",
      targetId: "dealer-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          providerReference: reference,
          metadata: {
            checkoutType: "dealer_subscription",
            listingId: null,
            dealerId: "dealer-1",
            tier: "PRO",
          },
        }),
      ),
    ).rejects.toThrow("Subscription payment reference has no checkout attempt");

    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).not.toHaveBeenCalled();
  });

  it("PAY-SUB-ATTEMPT-006 accepts an exact confirmed-attempt retry idempotently", async () => {
    const reference = createRippleReference({
      purpose: "dealer_subscription",
      targetId: "dealer-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
    });
    const attempt = {
      id: "attempt-1",
      userId: "user-1",
      dealerId: "dealer-1",
      paymentId: null,
      listingId: null,
      kind: "DEALER_SUBSCRIPTION",
      status: "CONFIRMED",
      merchantReference: reference,
      productCode: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      tier: "PRO",
      amountPence: 4999,
      currency: "gbp",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    };
    const existing = {
      id: "sub-1",
      dealerId: "dealer-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      providerSubscriptionId: "provider-sub-1",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-15T10:15:27.000Z"),
      lastProviderEventAt: new Date("2026-09-15T10:15:27.000Z"),
      lastProviderEventType: "payment.received",
      lastProviderEventFingerprint: "received-fingerprint",
    };
    (
      db.paymentCheckoutAttempt as { findUnique: ReturnType<typeof vi.fn> }
    ).findUnique.mockResolvedValue(attempt);
    subscriptionFindFirst.mockResolvedValue(existing);
    subscriptionUpdate.mockResolvedValue(existing);
    subscriptionChargeCreate.mockResolvedValue({ count: 0 });
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      amount: 4999,
      currency: "gbp",
    });
    (
      db.providerPaymentClaim as {
        findUnique: ReturnType<typeof vi.fn>;
      }
    ).findUnique.mockResolvedValue({
      attemptId: "attempt-1",
      subscriptionChargeId: "charge-1",
      subscriptionCharge: { subscriptionId: "sub-1" },
    });
    (
      db.paymentReconciliation as {
        findFirst: ReturnType<typeof vi.fn>;
      }
    ).findFirst.mockResolvedValue({
      id: "reconciliation-1",
      evidenceType: "VERIFIED_WEBHOOK",
      evidenceId: "success-fingerprint",
      providerPaymentId: "pay-renew-1",
    });

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          providerReference: reference,
          eventTimestamp: new Date("2026-10-10T10:15:27.000Z"),
          fingerprint: "success-fingerprint",
          metadata: {
            checkoutType: "dealer_subscription",
            listingId: null,
            dealerId: "dealer-1",
            tier: "PRO",
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(
      (db.providerPaymentClaim as { create: ReturnType<typeof vi.fn> }).create,
    ).not.toHaveBeenCalled();
    expect(
      (db.paymentReconciliation as { create: ReturnType<typeof vi.fn> }).create,
    ).not.toHaveBeenCalled();
  });

  it("PAY-REV-001 marks the exact refunded subscription charge", async () => {
    subscriptionChargeFindUnique.mockReset().mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      refundedAt: null,
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindFirst.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      status: "ACTIVE",
    });
    subscriptionUpdate.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      status: "ACTIVE",
    });

    await processProviderWebhookEvent(
      renewalEvent({
        type: "payment.refunded",
        fingerprint: "refund-fingerprint",
        metadata: {
          checkoutType: "dealer_subscription",
          listingId: null,
          dealerId: "dealer-1",
          tier: "PRO",
        },
      }),
    );

    expect(
      (
        db.subscriptionCharge as {
          updateMany: ReturnType<typeof vi.fn>;
        }
      ).updateMany,
    ).toHaveBeenCalledWith({
      where: { id: "charge-1", refundedAt: null },
      data: {
        refundedAt: new Date("2026-09-15T10:15:27.000Z"),
        refundEventId: "refund-fingerprint",
      },
    });
  });

  it("PAY-REV-002 keeps an early subscription refund retryable", async () => {
    subscriptionChargeFindUnique.mockReset().mockResolvedValue(null);

    await expect(
      processProviderWebhookEvent(
        renewalEvent({
          type: "payment.refunded",
          fingerprint: "refund-before-charge",
        }),
      ),
    ).rejects.toThrow("Subscription refund is waiting for its charge");

    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
  });

  it("PAY-REV-003 does not entitle a payment that already has a refund receipt", async () => {
    const refundedAt = new Date("2026-09-15T11:00:00.000Z");
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    (
      db.paymentWebhookInbox as { findFirst: ReturnType<typeof vi.fn> }
    ).findFirst.mockResolvedValue({
      id: "inbox-refund-1",
      eventTimestamp: refundedAt,
      amountPence: 4999,
      currency: "gbp",
    });

    await processProviderWebhookEvent(renewalEvent());

    expect(subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "INCOMPLETE",
        dealerId: "dealer-1",
      }),
    });
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
    expect(subscriptionChargeCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentReference: "pay-renew-1",
          refundedAt,
          refundEventId: "renewal-fingerprint",
        }),
      ],
      skipDuplicates: true,
    });
    expect(
      (db.paymentCheckoutAttempt as { update: ReturnType<typeof vi.fn> }).update,
    ).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });

    subscriptionChargeFindUnique.mockImplementation(() =>
      Promise.resolve({
        id: "charge-1",
        subscriptionId: "sub-1",
        amount: 4999,
        currency: "gbp",
        refundedAt,
      }),
    );
    subscriptionFindFirst.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "INCOMPLETE",
      currentPeriodEnd: null,
      source: "PAYMENT",
    });

    await processProviderWebhookEvent(
      renewalEvent({
        type: "payment.refunded",
        fingerprint: "refund-after-charge",
      }),
    );

    expect(subscriptionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["partial", 1000],
    ["zero", 0],
    ["missing", null],
  ] as const)("PAY-REV-011 does not retire a %s refund that arrived before the charge", async (_label, amountPence) => {
    subscriptionFindMany.mockResolvedValueOnce([{ dealerId: "dealer-1" }]);
    subscriptionFindFirst.mockResolvedValue(null);
    (
      db.paymentWebhookInbox as { findFirst: ReturnType<typeof vi.fn> }
    ).findFirst.mockResolvedValue({
      id: "inbox-refund-early",
      eventTimestamp: new Date("2026-09-15T11:00:00.000Z"),
      amountPence,
      currency: "gbp",
    });

    await processProviderWebhookEvent(renewalEvent());

    expect(subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "ACTIVE", dealerId: "dealer-1" }),
    });
    expect(subscriptionChargeCreate).toHaveBeenCalledWith({
      data: [expect.not.objectContaining({ refundedAt: expect.any(Date) })],
      skipDuplicates: true,
    });
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "applyRecurringPayment",
      tags: { refundClassification: amountPence === 1000 ? "partial" : "mismatch" },
    }));
  });

  it("PAY-REV-005 cancels activated coverage when the parsed refund has no period end", async () => {
    const order: string[] = [];
    (db.$executeRaw as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("lock");
      return 0;
    });
    subscriptionChargeFindUnique.mockImplementation(async () => {
      order.push("charge");
      return {
        id: "charge-1",
        subscriptionId: "sub-1",
        refundedAt: null,
        eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
        amount: 4999,
        currency: "gbp",
      };
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      charges: [
        {
          id: "charge-1",
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    subscriptionFindMany.mockResolvedValue([
      {
        id: "sub-1",
        source: "PAYMENT",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        status: "CANCELLED",
        currentPeriodEnd: null,
      },
    ]);
    const parsed = parseRippleWebhookEnvelope(rippleEnvelope({
      event: "payment.refunded",
      timestamp: "2030-12-20T00:00:00.000Z",
      data: {
        amount: 49.99,
        currency: "GBP",
        link_code: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        package: "Dealer Pro",
        recurring: true,
        link_type: "recurring",
        payment_reference: "pay-renew-1",
        description: "Dealer Pro",
      },
    }));

    expect(parsed.event.currentPeriodEnd).toBeNull();
    await processProviderWebhookEvent(parsed.event);

    expect(order.indexOf("lock")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("charge"));
    const [statement, key] = (db.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    expect(statement.join("")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(key).toBe("pay-renew-1");
    expect(db.$queryRaw).not.toHaveBeenCalled();
    const refundedAt = new Date("2030-12-20T00:00:00.000Z");
    expect(
      (db.subscriptionCharge as { updateMany: ReturnType<typeof vi.fn> }).updateMany,
    ).toHaveBeenCalledWith({
      where: { id: "charge-1", refundedAt: null },
      data: { refundedAt, refundEventId: parsed.event.fingerprint },
    });
    expect(isRecognisedSubscriptionCharge({ refundedAt })).toBe(false);
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "CANCELLED", currentPeriodEnd: null, cancelAtPeriodEnd: false },
    });
    expect(isPaidSubscriptionEntitled({ status: "CANCELLED", currentPeriodEnd: null })).toBe(false);
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
  });

  it("PAY-REV-006 replays a refund without restoring entitlement", async () => {
    const refundedAt = new Date("2030-12-20T00:00:00.000Z");
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      refundedAt,
      eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "CANCELLED",
      currentPeriodEnd: null,
      charges: [
        {
          id: "charge-1",
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt,
        },
      ],
    });

    await processProviderWebhookEvent(renewalEvent({
      type: "payment.refunded",
      eventTimestamp: refundedAt,
      fingerprint: "refund-replay",
    }));

    expect(
      (db.subscriptionCharge as { updateMany: ReturnType<typeof vi.fn> }).updateMany,
    ).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "CANCELLED", currentPeriodEnd: null, cancelAtPeriodEnd: false },
    });
    expect(dealerProfileUpdate).not.toHaveBeenCalled();
  });

  it("PAY-REV-007 keeps later unrefunded coverage and the pro tier", async () => {
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "older-charge",
      subscriptionId: "sub-1",
      refundedAt: null,
      eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      charges: [
        {
          id: "older-charge",
          eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
        {
          id: "later-charge",
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    subscriptionFindMany.mockResolvedValue([
      {
        id: "sub-1",
        source: "PAYMENT",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        status: "ACTIVE",
        currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      },
    ]);

    await processProviderWebhookEvent(renewalEvent({
      type: "payment.refunded",
      providerPaymentId: "pay-older",
      eventTimestamp: new Date("2030-12-20T00:00:00.000Z"),
      fingerprint: "refund-older",
    }));

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: {
        status: "ACTIVE",
        currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
      },
    });
    expect(dealerProfileUpdate).toHaveBeenCalledWith({
      where: { id: "dealer-1" },
      data: { tier: "PRO" },
    });
  });

  it("PAY-REV-008 keeps an independent starter subscription after the pro charge is refunded", async () => {
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "pro-charge",
      subscriptionId: "sub-pro",
      refundedAt: null,
      eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-pro",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      charges: [
        {
          id: "pro-charge",
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    subscriptionFindMany.mockResolvedValue([
      {
        id: "sub-pro",
        source: "PAYMENT",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        status: "CANCELLED",
        currentPeriodEnd: null,
      },
      {
        id: "sub-starter",
        source: "PAYMENT",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.starter.code,
        status: "ACTIVE",
        currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      },
    ]);

    await processProviderWebhookEvent(renewalEvent({
      type: "payment.refunded",
      eventTimestamp: new Date("2030-12-20T00:00:00.000Z"),
      fingerprint: "refund-pro",
    }));

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-pro" },
      data: { status: "CANCELLED", currentPeriodEnd: null, cancelAtPeriodEnd: false },
    });
    expect(dealerProfileUpdate).toHaveBeenCalledWith({
      where: { id: "dealer-1" },
      data: { tier: "STARTER" },
    });
  });

  it("PAY-REV-009 keeps scheduled cancellation when later coverage remains", async () => {
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "older-charge",
      subscriptionId: "sub-1",
      refundedAt: null,
      eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
      amount: 4999,
      currency: "gbp",
    });
    subscriptionFindUnique.mockResolvedValue({
      id: "sub-1",
      dealerId: "dealer-1",
      source: "PAYMENT",
      providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      charges: [
        {
          id: "older-charge",
          eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
        {
          id: "later-charge",
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });

    await processProviderWebhookEvent(renewalEvent({
      type: "payment.refunded",
      providerPaymentId: "pay-older",
      amount: 4999,
      currency: "gbp",
      eventTimestamp: new Date("2030-12-20T00:00:00.000Z"),
    }));

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({
        status: "ACTIVE",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
      }),
    });
  });

  it.each([
    ["partial", 1000, "gbp", "partial"],
    ["larger than the charge", 5000, "gbp", "mismatch"],
    ["missing", null, "gbp", "mismatch"],
    ["in another currency", 4999, "eur", "mismatch"],
  ] as const)("PAY-REV-010 does not retire a charge for a %s refund", async (_label, amount, currency, kind) => {
    subscriptionChargeFindUnique.mockResolvedValue({
      id: "charge-1",
      subscriptionId: "sub-1",
      refundedAt: null,
      amount: 4999,
      currency: "gbp",
    });

    await processProviderWebhookEvent(renewalEvent({
      type: "payment.refunded",
      amount,
      currency,
    }));

    expect(
      (db.subscriptionCharge as { updateMany: ReturnType<typeof vi.fn> }).updateMany,
    ).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(captureBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "Subscription refund was not applied",
      tags: { refundClassification: kind },
    }));
  });
});
