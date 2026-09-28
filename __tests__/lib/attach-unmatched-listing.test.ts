import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { RippleMinimizedPayload } from "@/lib/payments/ripple-contract";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  inboxFindUnique,
  inboxUpdateMany,
  listingFindUnique,
  paymentFindUnique,
  paymentFindFirst,
  paymentUpdateMany,
  createOrUpdateListingPayment,
  submitPaidListingForReview,
  dispatchListingNotifications,
  captureBusinessEvent,
  transaction,
  db,
  tx,
} = vi.hoisted(() => {
  const mocks = {
    inboxFindUnique: vi.fn(),
    inboxUpdateMany: vi.fn(),
    listingFindUnique: vi.fn(),
    paymentFindUnique: vi.fn(),
    paymentFindFirst: vi.fn(),
    paymentUpdateMany: vi.fn(),
    createOrUpdateListingPayment: vi.fn(),
    submitPaidListingForReview: vi.fn(),
    dispatchListingNotifications: vi.fn(),
    captureBusinessEvent: vi.fn(),
    transaction: vi.fn(),
  };
  const tx = {
    paymentWebhookInbox: {
      findUnique: mocks.inboxFindUnique,
      updateMany: mocks.inboxUpdateMany,
    },
    listing: { findUnique: mocks.listingFindUnique },
    payment: {
      findUnique: mocks.paymentFindUnique,
      findFirst: mocks.paymentFindFirst,
      updateMany: mocks.paymentUpdateMany,
    },
  };
  const db = {
    ...tx,
    $transaction: mocks.transaction,
  };
  return { ...mocks, db, tx };
});

vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/payments/webhook-payments", () => ({
  createOrUpdateListingPayment,
  submitPaidListingForReview,
}));

vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications,
}));

vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent }));

import {
  AttachUnmatchedListingError,
  attachUnmatchedListingPayment,
} from "@/lib/payments/attach-unmatched-listing";

const LISTING_ID = "caaaaaaaaaaaaaaaaaaaaaaaa";
const INBOX_ID = "cbbbbbbbbbbbbbbbbbbbbbbbb";
const PAYMENT_ID = "cccccccccccccccccccccccc";
const PROVIDER_PAYMENT_ID = "pay-volvo";

function listingMinimized(
  overrides: Partial<RippleMinimizedPayload> = {},
): RippleMinimizedPayload {
  return {
    event: "payment.received",
    client_id: "codelabplatfdcf3a8",
    timestamp: "2026-09-09T20:32:44.000Z",
    amount: 4.99,
    currency: "gbp",
    payment_reference: PROVIDER_PAYMENT_ID,
    merchant_reference: null,
    link_code: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    link_type: "one-off",
    recurring: false,
    package: "Private listing fee",
    description: "Private listing fee",
    reason: null,
    ...overrides,
  };
}

const pendingReference = () =>
  createRippleReference({
    purpose: "listing_payment",
    targetId: LISTING_ID,
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    nonce: "0123456789ab",
  });

function listingInbox(overrides: Record<string, unknown> = {}) {
  return {
    id: INBOX_ID,
    status: "FAILED",
    attemptCount: 3,
    lastErrorCode: "MISSING_REFERENCE",
    eventType: "payment.received",
    paymentReference: PROVIDER_PAYMENT_ID,
    merchantReference: null,
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    packageName: "Private listing fee",
    amountPence: 499,
    currency: "gbp",
    customerEmailNorm: "buyer@example.com",
    clientId: "codelabplatfdcf3a8",
    minimizedPayload: listingMinimized(),
    ...overrides,
  };
}

function pendingPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    listingId: LISTING_ID,
    paymentProvider: "RIPPLE",
    providerPaymentId: null,
    providerReference: pendingReference(),
    amount: 499,
    currency: "gbp",
    type: "LISTING",
    status: "PENDING",
    ...overrides,
  };
}

describe("attachUnmatchedListingPayment", () => {
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback) => callback(tx));
    inboxFindUnique.mockResolvedValue(listingInbox());
    inboxUpdateMany.mockResolvedValue({ count: 1 });
    listingFindUnique.mockResolvedValue({ id: LISTING_ID });
    paymentFindUnique.mockResolvedValue(null);
    paymentFindFirst.mockResolvedValue(pendingPayment());
    paymentUpdateMany.mockResolvedValue({ count: 1 });
    createOrUpdateListingPayment.mockResolvedValue({
      payment: { id: PAYMENT_ID, listingId: LISTING_ID },
      applied: true,
    });
    submitPaidListingForReview.mockResolvedValue([{ kind: "submitted" }]);
    dispatchListingNotifications.mockResolvedValue(undefined);
    captureBusinessEvent.mockResolvedValue(undefined);
  });

  const attach = (overrides: Record<string, unknown> = {}) =>
    attachUnmatchedListingPayment({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
      confirmedCurrentlyPaidAndNotRefunded: true,
      ...overrides,
    } as Parameters<typeof attachUnmatchedListingPayment>[0]);

  it("attaches only a successful unreferenced receipt to the signed pending listing payment in one transaction", async () => {
    const result = await attach();

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(inboxUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: INBOX_ID,
        status: "FAILED",
        lastErrorCode: { in: ["MISSING_REFERENCE", "INVALID_REFERENCE"] },
        attemptCount: 3,
      },
      data: {
        status: "PROCESSING",
        lastErrorCode: null,
        attemptCount: { increment: 1 },
      },
    });
    expect(createOrUpdateListingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment.received",
        paymentStatus: "SUCCEEDED",
        metadata: expect.objectContaining({
          checkoutType: "listing_payment",
          listingId: LISTING_ID,
        }),
        providerPaymentId: PROVIDER_PAYMENT_ID,
        providerReference: pendingPayment().providerReference,
      }),
      "SUCCEEDED",
      tx,
    );
    expect(submitPaidListingForReview).toHaveBeenCalledWith(
      LISTING_ID,
      expect.any(Object),
      tx,
    );
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: PAYMENT_ID,
        listingId: LISTING_ID,
        type: "LISTING",
        paymentProvider: "RIPPLE",
        status: "PENDING",
        providerPaymentId: null,
        providerReference: pendingPayment().providerReference,
      },
      data: { providerPaymentId: PROVIDER_PAYMENT_ID },
    });
    expect(inboxUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: INBOX_ID, status: "PROCESSING", attemptCount: 4 },
      data: {
        status: "PROCESSED",
        processedAt: expect.any(Date),
        lastErrorCode: null,
      },
    });
    expect(result).toMatchObject({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
      merchantReference: pendingPayment().providerReference,
      providerPaymentId: PROVIDER_PAYMENT_ID,
      amountPence: 499,
    });
    expect(dispatchListingNotifications).toHaveBeenCalledWith([
      { kind: "submitted" },
    ]);
  });

  it.each([
    ["payment.failed", { event: "payment.failed" }],
    ["payment.success", { event: "payment.success" }],
    ["missing provider reference", { payment_reference: null }],
    ["wrong currency", { currency: "eur" }],
    ["wrong amount", { amount: 5 }],
    ["recurring flag", { recurring: true }],
    ["recurring link type", { link_type: "recurring" }],
  ])("rejects %s without mutating records", async (_label, payload) => {
    inboxFindUnique.mockResolvedValue(
      listingInbox({
        minimizedPayload: listingMinimized(payload as Partial<RippleMinimizedPayload>),
        eventType: (payload as Partial<RippleMinimizedPayload>).event ?? "payment.received",
        paymentReference:
          (payload as Partial<RippleMinimizedPayload>).payment_reference === null
            ? null
            : PROVIDER_PAYMENT_ID,
      }),
    );

    await expect(attach()).rejects.toBeInstanceOf(AttachUnmatchedListingError);
    expect(inboxUpdateMany).not.toHaveBeenCalled();
    expect(createOrUpdateListingPayment).not.toHaveBeenCalled();
    expect(submitPaidListingForReview).not.toHaveBeenCalled();
    expect(dispatchListingNotifications).not.toHaveBeenCalled();
  });

  it("requires explicit current portal-paid and not-refunded confirmation", async () => {
    await expect(
      attach({ confirmedCurrentlyPaidAndNotRefunded: false }),
    ).rejects.toThrow();
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["processed", { status: "PROCESSED" }],
    ["quarantined", { status: "QUARANTINED" }],
    ["wrong failure", { lastErrorCode: "AMOUNT_MISMATCH" }],
    ["other event", { eventType: "payment.failed" }],
    ["different inbox payment reference", { paymentReference: "other-ref" }],
  ])("rejects an ineligible inbox row: %s", async (_label, row) => {
    inboxFindUnique.mockResolvedValue(listingInbox(row));
    await expect(attach()).rejects.toBeInstanceOf(AttachUnmatchedListingError);
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a valid inbound reference that conflicts with the admin-selected listing", async () => {
    const conflictingReference = createRippleReference({
      purpose: "listing_payment",
      targetId: "cdddddddddddddddddddddddd",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
      nonce: "abcdef012345",
    });
    inboxFindUnique.mockResolvedValue(
      listingInbox({
        merchantReference: conflictingReference,
        minimizedPayload: listingMinimized({
          merchant_reference: conflictingReference,
        }),
      }),
    );

    await expect(attach()).rejects.toThrow("already contains a valid reference");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects invalid pending-payment reference claims or a reference for another listing", async () => {
    paymentFindFirst.mockResolvedValue(
      pendingPayment({
        providerReference: createRippleReference({
          purpose: "listing_payment",
          targetId: "cdddddddddddddddddddddddd",
          linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
          nonce: "abcdef012345",
        }),
      }),
    );

    await expect(attach()).rejects.toThrow("does not match this listing");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["no pending fee", null],
    ["wrong payment provider", { paymentProvider: "STRIPE" }],
    ["wrong amount", { amount: 500 }],
    ["wrong currency", { currency: "eur" }],
    ["wrong type", { type: "FEATURED" }],
    ["already assigned provider ID", { providerPaymentId: "prior-ref" }],
  ])("requires an eligible pending listing payment: %s", async (_label, paymentOverrides) => {
    paymentFindFirst.mockResolvedValue(
      paymentOverrides ? pendingPayment(paymentOverrides) : null,
    );
    await expect(attach()).rejects.toBeInstanceOf(AttachUnmatchedListingError);
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects provider references already assigned to another payment", async () => {
    paymentFindUnique.mockResolvedValue({
      ...pendingPayment({ id: "other-payment", listingId: "other-listing" }),
    });

    await expect(attach()).rejects.toThrow("already assigned to another payment");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic inbox claim loses a race", async () => {
    inboxUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(attach()).rejects.toThrow("already being processed");
    expect(createOrUpdateListingPayment).not.toHaveBeenCalled();
    expect(submitPaidListingForReview).not.toHaveBeenCalled();
  });

  it("fails closed when another inbox has already reserved the same pending payment", async () => {
    paymentUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(attach()).rejects.toThrow(
      "Pending payment was already claimed or changed",
    );
    expect(paymentUpdateMany).toHaveBeenCalledOnce();
    expect(createOrUpdateListingPayment).not.toHaveBeenCalled();
    expect(submitPaidListingForReview).not.toHaveBeenCalled();
    expect(inboxUpdateMany).toHaveBeenCalledOnce();
  });

  it("rolls back the inbox claim when transactional fulfillment fails", async () => {
    submitPaidListingForReview.mockRejectedValue(new Error("transition failed"));

    await expect(attach()).rejects.toThrow("transition failed");
    expect(inboxUpdateMany).toHaveBeenCalledTimes(1);
    expect(dispatchListingNotifications).not.toHaveBeenCalled();
  });

  it("does not repeat fulfillment or notifications when the same provider payment is already attached to this listing", async () => {
    paymentFindUnique.mockResolvedValue(
      pendingPayment({
        status: "SUCCEEDED",
        providerPaymentId: PROVIDER_PAYMENT_ID,
      }),
    );
    inboxFindUnique.mockResolvedValue(
      listingInbox({ status: "PROCESSED", lastErrorCode: null }),
    );

    await expect(attach()).resolves.toMatchObject({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
      providerPaymentId: PROVIDER_PAYMENT_ID,
    });
    expect(createOrUpdateListingPayment).not.toHaveBeenCalled();
    expect(submitPaidListingForReview).not.toHaveBeenCalled();
    expect(dispatchListingNotifications).not.toHaveBeenCalled();
  });

  it("rejects a payment reference already attached to a different listing", async () => {
    paymentFindUnique.mockResolvedValue(
      pendingPayment({
        status: "SUCCEEDED",
        listingId: "cdddddddddddddddddddddddd",
        providerPaymentId: PROVIDER_PAYMENT_ID,
      }),
    );

    await expect(attach()).rejects.toThrow("already assigned to another payment");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an existing provider payment ID attached to a non-Ripple payment", async () => {
    paymentFindUnique.mockResolvedValue(
      pendingPayment({
        paymentProvider: "STRIPE",
        status: "SUCCEEDED",
        providerPaymentId: PROVIDER_PAYMENT_ID,
      }),
    );

    await expect(attach()).rejects.toThrow("already assigned to another payment");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
  });
});
