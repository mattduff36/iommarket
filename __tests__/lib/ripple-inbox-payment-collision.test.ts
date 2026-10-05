import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

const mocks = vi.hoisted(() => ({
  inboxFindUnique: vi.fn(),
  inboxUpdateMany: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentUpdate: vi.fn(),
  paymentCreate: vi.fn(),
  transaction: vi.fn(),
  capture: vi.fn(),
  reconcile: vi.fn(),
  event: null as NormalizedProviderWebhookEvent | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    paymentWebhookInbox: { findUnique: mocks.inboxFindUnique, updateMany: mocks.inboxUpdateMany },
    paymentCheckoutAttempt: {
      findUnique: vi.fn().mockResolvedValue({ id: "attempt-1" }),
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: mocks.capture, captureException: vi.fn() }));
vi.mock("@/lib/payments/reconcile-payment", () => ({
  reconcileListingPayment: mocks.reconcile,
}));
vi.mock("@/lib/payments/ripple-contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/ripple-contract")>()),
  eventFromMinimizedPayload: () => mocks.event,
}));

import { processRippleInboxRecord } from "@/lib/payments/ripple-inbox";

describe("Ripple inbox quarantines listing charge collisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcile.mockRejectedValue(
      new Error("subscription charge collision"),
    );
    const product = RIPPLE_CANONICAL_PRODUCTS.listingAndFeatured;
    mocks.event = {
      id: "evt-duplicate-charge", type: "payment.received", rawType: "payment.received",
      providerPaymentId: "provider-payment-new", providerReference: "signed-reference-new",
      providerSubscriptionId: null, providerPlanId: null, paymentStatus: "SUCCEEDED",
      subscriptionStatus: null, amount: product.amountPence, currency: "gbp",
      currentPeriodEnd: null, cancelAtPeriodEnd: null, eventTimestamp: new Date(),
      clientId: "client", customerEmail: null, linkCode: product.code, packageName: null,
      recurring: false, linkType: "one-off", fingerprint: "evt-duplicate-charge",
      metadata: { checkoutType: "listing_and_featured", listingId: "listing-1", dealerId: null, tier: null },
      payload: {},
    };
    const existing = {
      id: "payment-1", listingId: "listing-1", status: "PENDING", refundedAt: null,
      providerPaymentId: "provider-payment-old", providerReference: "signed-reference-old",
      paymentProvider: "RIPPLE",
    };
    const tx = {
      payment: {
        findMany: mocks.paymentFindMany,
        findFirst: mocks.paymentFindFirst,
        update: mocks.paymentUpdate,
        create: mocks.paymentCreate,
      },
    };
    mocks.paymentFindMany.mockImplementation(async () =>
      mocks.event?.providerReference === existing.providerReference ? [existing] : [],
    );
    mocks.paymentFindFirst.mockResolvedValue(existing);
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.inboxFindUnique.mockResolvedValue({
      id: "inbox-1", bodyHash: "hash", eventType: "payment.received", status: "PENDING",
      attemptCount: 0, minimizedPayload: {}, customerEmailNorm: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    mocks.inboxUpdateMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ["same merchant reference with a second provider payment ID", "signed-reference-old"],
    ["a new merchant reference while an earlier checkout remains pending", "signed-reference-new"],
  ])("quarantines %s rather than marking it processed", async (_description, reference) => {
    if (mocks.event) mocks.event.providerReference = reference;

    await expect(processRippleInboxRecord("inbox-1")).resolves.toEqual({ status: "quarantined" });

    expect(mocks.inboxUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { status: "QUARANTINED", lastErrorCode: "CHARGE_COLLISION" },
    }));
    expect(mocks.inboxUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PROCESSED" }),
    }));
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });
});
