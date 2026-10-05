import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSerializable: vi.fn(),
}));

vi.mock("@/lib/payments/transaction", () => ({
  runPaymentSerializable: mocks.runSerializable,
}));

import {
  persistCheckoutAttempt,
  recordHostedReturnObservation,
} from "@/lib/payments/checkout-attempts";

describe("payment checkout attempts", () => {
  const tx = {
    paymentCheckoutAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    paymentCheckoutObservation: {
      upsert: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSerializable.mockImplementation((operation) => operation(tx));
    tx.paymentCheckoutAttempt.findUnique.mockResolvedValue(null);
    tx.paymentCheckoutAttempt.findFirst.mockResolvedValue(null);
    tx.paymentCheckoutAttempt.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "attempt-1", status: "OPEN", ...data }),
    );
  });

  it.each([
    ["LISTING_PAYMENT", "listing-1", "payment-1", undefined, undefined],
    ["LISTING_AND_FEATURED", "listing-1", "payment-1", undefined, undefined],
    ["FEATURED_UPGRADE", "listing-1", "payment-1", undefined, undefined],
    ["DEALER_SUBSCRIPTION", undefined, undefined, "dealer-1", "PRO"],
  ] as const)(
    "PAY-ATT-001 snapshots %s before redirect",
    async (kind, listingId, paymentId, dealerId, tier) => {
      await persistCheckoutAttempt({
        userId: "user-1",
        kind,
        merchantReference: `signed-${kind}`,
        productCode: "PRODUCT",
        amountPence: 500,
        listingId,
        paymentId,
        dealerId,
        tier,
      });

      expect(tx.paymentCheckoutAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          kind,
          merchantReference: `signed-${kind}`,
          productCode: "PRODUCT",
          amountPence: 500,
          currency: "gbp",
          listingId,
          paymentId,
          dealerId,
          tier,
        }),
      });
    },
  );

  it("PAY-ATT-002 reuses a matching open attempt", async () => {
    const existing = {
      id: "attempt-1",
      userId: "user-1",
      kind: "FEATURED_UPGRADE",
      listingId: "listing-1",
      dealerId: null,
      paymentId: "payment-1",
      productCode: "FEATURED",
      amountPence: 500,
      currency: "gbp",
      tier: null,
      status: "OPEN",
      expiresAt: new Date(Date.now() + 60_000),
    };
    tx.paymentCheckoutAttempt.findUnique.mockResolvedValue(existing);

    await expect(
      persistCheckoutAttempt({
        userId: "user-1",
        kind: "FEATURED_UPGRADE",
        merchantReference: "new-reference",
        productCode: "FEATURED",
        amountPence: 500,
        listingId: "listing-1",
        paymentId: "payment-1",
      }),
    ).resolves.toBe(existing);
    expect(tx.paymentCheckoutAttempt.create).not.toHaveBeenCalled();
  });

  it("PAY-RET-001 stores browser return as observation only", async () => {
    tx.paymentCheckoutAttempt.findUnique.mockResolvedValue({
      id: "attempt-1",
      userId: "user-1",
      status: "OPEN",
      returnedAt: null,
      observations: [],
    });
    tx.paymentCheckoutObservation.upsert.mockResolvedValue({});
    tx.paymentCheckoutAttempt.update.mockResolvedValue({});

    await recordHostedReturnObservation({
      merchantReference: "signed-reference",
      userId: "user-1",
      providerPaymentId: "260921004609311316",
    });

    expect(tx.paymentCheckoutObservation.upsert).toHaveBeenCalled();
    expect(tx.paymentCheckoutAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RETURNED" }),
      }),
    );
    expect(tx).not.toHaveProperty("payment");
  });

  it("PAY-RET-002 quarantines conflicting browser observations", async () => {
    tx.paymentCheckoutAttempt.findUnique.mockResolvedValue({
      id: "attempt-1",
      userId: "user-1",
      status: "RETURNED",
      returnedAt: new Date(),
      observations: [{ providerPaymentId: "1111111111" }],
    });
    tx.paymentCheckoutObservation.upsert.mockResolvedValue({});
    tx.paymentCheckoutAttempt.update.mockResolvedValue({});

    await expect(
      recordHostedReturnObservation({
        merchantReference: "signed-reference",
        userId: "user-1",
        providerPaymentId: "2222222222",
      }),
    ).resolves.toEqual({ attemptId: "attempt-1", conflicts: true });
    expect(tx.paymentCheckoutAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REVIEW" }),
      }),
    );
  });
});
