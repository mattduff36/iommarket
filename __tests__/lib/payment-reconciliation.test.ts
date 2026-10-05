import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSerializable: vi.fn(),
  applyFeatured: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/payments/transaction", () => ({
  runPaymentSerializable: mocks.runSerializable,
}));
vi.mock("@/lib/payments/featured-entitlement", () => ({
  applyPaidFeaturedEntitlement: mocks.applyFeatured,
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit }));

import {
  PaymentReconciliationError,
  reconcileListingPayment,
} from "@/lib/payments/reconcile-payment";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { installRippleTestEnv } from "./ripple-test-env";

describe("Featured payment reconciliation", () => {
  const providerPaymentId = "260921004609311316";
  let attempt: Record<string, unknown>;
  type MockModel = Record<string, ReturnType<typeof vi.fn>>;
  let tx: {
    $queryRaw: ReturnType<typeof vi.fn>;
    paymentCheckoutAttempt: MockModel;
    paymentWebhookInbox: MockModel;
    payment: MockModel;
    subscriptionCharge: MockModel;
    providerPaymentClaim: MockModel;
    paymentReconciliation: MockModel;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installRippleTestEnv();
    const merchantReference = createRippleReference({
      purpose: "featured_upgrade",
      targetId: "listing-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.featured.code,
    });
    attempt = {
      id: "attempt-1",
      userId: "user-1",
      listingId: "listing-1",
      dealerId: null,
      paymentId: "payment-1",
      kind: "FEATURED_UPGRADE",
      status: "REVIEW",
      merchantReference,
      productCode: RIPPLE_CANONICAL_PRODUCTS.featured.code,
      amountPence: 500,
      currency: "gbp",
      createdAt: new Date("2026-10-05T11:00:00Z"),
      reconciliations: [],
      providerClaims: [],
      payment: {
        id: "payment-1",
        listingId: "listing-1",
        listing: { id: "listing-1", userId: "user-1" },
        paymentProvider: "RIPPLE",
        providerReference: merchantReference,
        providerPaymentId: null,
        amount: 500,
        currency: "gbp",
        type: "FEATURED",
        includesFeatured: false,
        featuredAppliedAt: null,
        refundedAt: null,
        status: "PENDING",
      },
    };
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      paymentCheckoutAttempt: {
        findFirst: vi.fn().mockResolvedValue(attempt),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentWebhookInbox: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionCharge: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      providerPaymentClaim: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      paymentReconciliation: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    mocks.runSerializable.mockImplementation((operation) => operation(tx));
    mocks.applyFeatured.mockResolvedValue(true);
    mocks.audit.mockResolvedValue({});
  });

  function adminInput(evidenceId = "admin:evidence-1") {
    return {
      paymentId: "payment-1",
      providerPaymentId,
      providerEventAt: new Date("2026-10-05T11:29:57Z"),
      evidence: {
        type: "ADMIN_PROVIDER_ATTESTATION" as const,
        evidenceId,
        adminId: "admin-1",
        notes: "Verified in Ripple portal",
        snapshot: {
          confirmedAmountCurrencyProduct: true,
          confirmedCurrentlyPaidAndNotRefunded: true,
        },
      },
    };
  }

  it("PAY-FTR-001 reconciles a valid pending Featured payment once", async () => {
    await expect(reconcileListingPayment(adminInput())).resolves.toEqual({
      paymentId: "payment-1",
      listingId: "listing-1",
      featuredApplied: true,
      idempotent: false,
      notifications: [],
    });
    expect(tx.providerPaymentClaim.create).toHaveBeenCalled();
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          providerPaymentId,
        }),
      }),
    );
    expect(mocks.applyFeatured).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("PAY-REC-001 records verified webhook provenance through the same core", async () => {
    await reconcileListingPayment({
      merchantReference: attempt.merchantReference as string,
      providerPaymentId,
      providerEventAt: new Date("2026-10-05T11:29:57Z"),
      event: {
        id: "event-1",
        type: "payment.received",
        rawType: "payment.received",
        providerPaymentId,
        providerReference: attempt.merchantReference as string,
        providerSubscriptionId: null,
        providerPlanId: null,
        paymentStatus: "SUCCEEDED",
        subscriptionStatus: null,
        amount: 500,
        currency: "gbp",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: null,
        eventTimestamp: new Date("2026-10-05T11:29:57Z"),
        clientId: "client",
        customerEmail: "buyer@example.com",
        linkCode: RIPPLE_CANONICAL_PRODUCTS.featured.code,
        packageName: "Featured",
        recurring: false,
        linkType: "one-off",
        fingerprint: "webhook-fingerprint",
        metadata: {
          checkoutType: "featured_upgrade",
          listingId: "listing-1",
          dealerId: null,
          tier: null,
        },
        payload: {},
      },
      evidence: {
        type: "VERIFIED_WEBHOOK",
        evidenceId: "webhook-fingerprint",
        snapshot: { eventType: "payment.received" },
      },
    });

    expect(tx.providerPaymentClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "VERIFIED_WEBHOOK" }),
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("PAY-REC-002 returns the identical completed retry idempotently", async () => {
    const payment = attempt.payment as Record<string, unknown>;
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = providerPaymentId;
    attempt.reconciliations = [
      {
        evidenceType: "ADMIN_PROVIDER_ATTESTATION",
        evidenceId: "admin:evidence-1",
        providerPaymentId,
      },
    ];

    await expect(reconcileListingPayment(adminInput())).resolves.toEqual(
      expect.objectContaining({ idempotent: true }),
    );
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("PAY-REC-003 rejects different evidence after completion", async () => {
    attempt.reconciliations = [
      {
        evidenceType: "VERIFIED_WEBHOOK",
        evidenceId: "webhook-1",
        providerPaymentId,
      },
    ];
    await expect(reconcileListingPayment(adminInput())).rejects.toThrow(
      "already reconciled with different evidence",
    );
  });

  it("PAY-RACE-001 rejects admin recovery when a webhook wins the provider claim", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" },
    );
    tx.providerPaymentClaim.create.mockRejectedValueOnce(conflict);
    const pendingAttempt = {
      ...attempt,
      reconciliations: [] as unknown[],
      payment: { ...(attempt.payment as Record<string, unknown>) },
    };
    const webhookWinner = {
      ...attempt,
      reconciliations: [
        {
          evidenceType: "VERIFIED_WEBHOOK",
          evidenceId: "webhook-1",
          providerPaymentId,
        },
      ],
      payment: {
        ...(attempt.payment as Record<string, unknown>),
        status: "SUCCEEDED",
        providerPaymentId,
        featuredAppliedAt: new Date("2026-10-05T11:30:00Z"),
      },
    };
    let lookups = 0;
    tx.paymentCheckoutAttempt.findFirst.mockImplementation(async () => {
      lookups += 1;
      return lookups <= 2 ? pendingAttempt : webhookWinner;
    });

    await expect(reconcileListingPayment(adminInput())).rejects.toThrow(
      "already reconciled with different evidence",
    );
    expect(mocks.applyFeatured).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.providerPaymentClaim.create).toHaveBeenCalledTimes(1);
  });

  it("PAY-RACE-002 accepts an identical winner after a lost unique claim", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" },
    );
    tx.providerPaymentClaim.create.mockRejectedValueOnce(conflict);
    const completed = {
      ...attempt,
      reconciliations: [
        {
          evidenceType: "ADMIN_PROVIDER_ATTESTATION",
          evidenceId: "admin:evidence-1",
          providerPaymentId,
        },
      ],
      payment: {
        ...(attempt.payment as Record<string, unknown>),
        status: "SUCCEEDED",
        providerPaymentId,
        featuredAppliedAt: new Date("2026-10-05T11:30:00Z"),
      },
    };
    let lookups = 0;
    tx.paymentCheckoutAttempt.findFirst.mockImplementation(async () => {
      lookups += 1;
      return lookups <= 2 ? attempt : completed;
    });

    await expect(reconcileListingPayment(adminInput())).resolves.toEqual(
      expect.objectContaining({
        idempotent: true,
        featuredApplied: true,
      }),
    );
    expect(mocks.applyFeatured).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("PAY-RACE-003 stops repeated unique conflicts before granting Featured", async () => {
    tx.providerPaymentClaim.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(reconcileListingPayment(adminInput())).rejects.toThrow(
      "could not obtain a unique provider claim",
    );
    expect(mocks.applyFeatured).not.toHaveBeenCalled();
    expect(tx.providerPaymentClaim.create).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["amount", () => ((attempt.payment as Record<string, unknown>).amount = 50)],
    ["currency", () => ((attempt.payment as Record<string, unknown>).currency = "usd")],
    ["refund", () => ((attempt.payment as Record<string, unknown>).refundedAt = new Date())],
    ["product", () => (attempt.productCode = RIPPLE_CANONICAL_PRODUCTS.listing.code)],
  ])("PAY-FTR-002 blocks an invalid %s contract", async (_name, mutate) => {
    mutate();
    await expect(reconcileListingPayment(adminInput())).rejects.toBeInstanceOf(
      PaymentReconciliationError,
    );
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("PAY-FTR-003 recognizes payment without consuming entitlement when listing is not live", async () => {
    mocks.applyFeatured.mockResolvedValue(false);
    await expect(reconcileListingPayment(adminInput())).resolves.toEqual(
      expect.objectContaining({ featuredApplied: false }),
    );
  });

  it("PAY-REF-001 rejects a provider reference claimed by a subscription", async () => {
    tx.subscriptionCharge.findUnique.mockResolvedValue({ id: "charge-1" });
    await expect(reconcileListingPayment(adminInput())).rejects.toThrow(
      "already claimed",
    );
  });

  it("PAY-REC-004 fails the transaction when audit logging fails", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(reconcileListingPayment(adminInput())).rejects.toThrow(
      "audit unavailable",
    );
  });
});
