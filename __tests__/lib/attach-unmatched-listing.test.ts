import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { RippleMinimizedPayload } from "@/lib/payments/ripple-contract";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  inboxFindUnique,
  inboxUpdate,
  inboxUpdateMany,
  listingFindUnique,
  paymentFindFirst,
  handleOneOffPaymentReceived,
} = vi.hoisted(() => ({
  inboxFindUnique: vi.fn(),
  inboxUpdate: vi.fn(),
  inboxUpdateMany: vi.fn(),
  listingFindUnique: vi.fn(),
  paymentFindFirst: vi.fn(),
  handleOneOffPaymentReceived: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    paymentWebhookInbox: {
      findUnique: inboxFindUnique,
      update: inboxUpdate,
      updateMany: inboxUpdateMany,
    },
    listing: {
      findUnique: listingFindUnique,
    },
    payment: {
      findFirst: paymentFindFirst,
    },
  },
}));

vi.mock("@/lib/payments/webhook-payments", () => ({
  handleOneOffPaymentReceived,
}));

import {
  AttachUnmatchedListingError,
  attachUnmatchedListingPayment,
} from "@/lib/payments/attach-unmatched-listing";

const LISTING_ID = "caaaaaaaaaaaaaaaaaaaaaaaa";
const INBOX_ID = "cbbbbbbbbbbbbbbbbbbbbbbbb";

function listingMinimized(): RippleMinimizedPayload {
  return {
    event: "payment.received",
    client_id: "codelabplatfdcf3a8",
    timestamp: "2026-09-09T20:32:44.000Z",
    amount: 4.99,
    currency: "gbp",
    payment_reference: "pay-volvo",
    merchant_reference: null,
    link_code: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    link_type: "one-off",
    recurring: false,
    package: "Private listing fee",
    description: "Private listing fee",
    reason: null,
  };
}

function listingInbox(overrides: Record<string, unknown> = {}) {
  return {
    id: INBOX_ID,
    status: "FAILED",
    attemptCount: 3,
    lastErrorCode: "MISSING_REFERENCE",
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    packageName: "Private listing fee",
    amountPence: 499,
    customerEmailNorm: "buyer@example.com",
    clientId: "codelabplatfdcf3a8",
    minimizedPayload: listingMinimized(),
    ...overrides,
  };
}

describe("attachUnmatchedListingPayment", () => {
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    listingFindUnique.mockResolvedValue({ id: LISTING_ID });
    inboxUpdate.mockResolvedValue({ id: INBOX_ID });
    inboxUpdateMany.mockResolvedValue({ count: 1 });
    paymentFindFirst.mockResolvedValue(null);
    handleOneOffPaymentReceived.mockResolvedValue(undefined);
  });

  it("RIP-ADMIN-001 binds a listing-fee inbox and applies the signed listing claims", async () => {
    inboxFindUnique.mockResolvedValue(listingInbox());

    const result = await attachUnmatchedListingPayment({
      inboxId: INBOX_ID,
      listingId: LISTING_ID,
    });

    expect(inboxUpdateMany).toHaveBeenCalledWith({
      where: {
        id: INBOX_ID,
        status: { in: ["PENDING", "FAILED"] },
        attemptCount: 3,
      },
      data: {
        status: "PROCESSING",
        lastErrorCode: null,
        attemptCount: { increment: 1 },
      },
    });
    expect(handleOneOffPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          checkoutType: "listing_payment",
          listingId: LISTING_ID,
        }),
        providerReference: result.merchantReference,
      }),
    );
    expect(inboxUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: INBOX_ID,
        status: "PROCESSING",
        attemptCount: 4,
      },
      data: expect.objectContaining({
        status: "PROCESSED",
        lastErrorCode: null,
        merchantReference: result.merchantReference,
      }),
    });
  });

  it("RIP-ADMIN-001 rejects a dealer-package inbox", async () => {
    inboxFindUnique.mockResolvedValue(
      listingInbox({
        linkCode: RIPPLE_CANONICAL_PRODUCTS.starter.code,
        packageName: "Dealer Starter subscription",
        amountPence: 2999,
        minimizedPayload: {
          ...listingMinimized(),
          link_code: RIPPLE_CANONICAL_PRODUCTS.starter.code,
          package: "Dealer Starter subscription",
          amount: 29.99,
        },
      }),
    );

    await expect(
      attachUnmatchedListingPayment({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toBeInstanceOf(AttachUnmatchedListingError);
    expect(handleOneOffPaymentReceived).not.toHaveBeenCalled();
    expect(inboxUpdate).not.toHaveBeenCalled();
  });

  it("does not auto-match from email or amount when the product is unknown", async () => {
    inboxFindUnique.mockResolvedValue(
      listingInbox({
        linkCode: "UNKNOWNCODE123456",
        packageName: "Mystery product",
        amountPence: 499,
      }),
    );

    await expect(
      attachUnmatchedListingPayment({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toThrow("Inbox row is not a listing fee");
    expect(handleOneOffPaymentReceived).not.toHaveBeenCalled();
  });

  it("RIP-ADMIN-001 claims the inbox so a second attach cannot bind another listing", async () => {
    inboxFindUnique.mockResolvedValue(listingInbox());
    inboxUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      attachUnmatchedListingPayment({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toThrow("Inbox row is already being processed");
    expect(handleOneOffPaymentReceived).not.toHaveBeenCalled();
    expect(inboxUpdate).not.toHaveBeenCalled();
  });

  it("RIP-ADMIN-003 rejects attach when the listing already has a succeeded fee", async () => {
    inboxFindUnique.mockResolvedValue(listingInbox());
    paymentFindFirst.mockResolvedValue({ id: "paid-1" });

    await expect(
      attachUnmatchedListingPayment({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toThrow("Listing already has a succeeded listing fee");
    expect(inboxUpdateMany).not.toHaveBeenCalled();
    expect(handleOneOffPaymentReceived).not.toHaveBeenCalled();
  });

  it("RIP-ADMIN-004 does not mark the inbox processed after its claim changes", async () => {
    inboxFindUnique.mockResolvedValue(listingInbox());
    inboxUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      attachUnmatchedListingPayment({
        inboxId: INBOX_ID,
        listingId: LISTING_ID,
      }),
    ).rejects.toThrow("Inbox claim changed before attach completed");
    expect(handleOneOffPaymentReceived).toHaveBeenCalledOnce();
  });
});
