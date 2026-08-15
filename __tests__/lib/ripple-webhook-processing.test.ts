import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  paymentFindMany,
  paymentCreate,
  paymentUpdate,
  listingFindUnique,
  listingUpdateMany,
  listingImageCount,
  transitionListingStatus,
  captureBusinessEvent,
  transactionMock,
  db,
} = vi.hoisted(() => {
  const paymentFindMany = vi.fn();
  const paymentCreate = vi.fn();
  const paymentUpdate = vi.fn();
  const listingFindUnique = vi.fn();
  const listingUpdateMany = vi.fn();
  const listingImageCount = vi.fn();
  const transactionMock = vi.fn();
  const db: {
    payment: { findMany: typeof paymentFindMany; create: typeof paymentCreate; update: typeof paymentUpdate };
    listing: { findUnique: typeof listingFindUnique; updateMany: typeof listingUpdateMany };
    listingImage: { count: typeof listingImageCount };
    $transaction: (fn: (tx: unknown) => unknown) => Promise<unknown>;
  } = {
    payment: {
      findMany: paymentFindMany,
      create: paymentCreate,
      update: paymentUpdate,
    },
    listing: {
      findUnique: listingFindUnique,
      updateMany: listingUpdateMany,
    },
    listingImage: {
      count: listingImageCount,
    },
    $transaction: transactionMock,
  };
  return {
    paymentFindMany,
    paymentCreate,
    paymentUpdate,
    listingFindUnique,
    listingUpdateMany,
    listingImageCount,
    transitionListingStatus: vi.fn(),
    captureBusinessEvent: vi.fn(),
    transactionMock,
    db,
  };
});

vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/listings/status-events", () => ({
  transitionListingStatus,
}));

const dispatchListingNotifications = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent,
}));

import { processProviderWebhookEvent } from "@/lib/payments/webhook-processing";

function listingEvent(
  overrides: Partial<NormalizedProviderWebhookEvent> = {}
): NormalizedProviderWebhookEvent {
  return {
    id: "evt-listing",
    type: "payment.received",
    rawType: "payment.received",
    providerPaymentId: "pay-1",
    providerReference: "v1:listing_payment:listing-1:nonce:mac",
    providerSubscriptionId: null,
    providerPlanId: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    paymentStatus: "SUCCEEDED",
    subscriptionStatus: null,
    amount: 499,
    currency: "gbp",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventTimestamp: new Date("2026-08-15T10:15:27.000Z"),
    clientId: "codelabplatfdcf3a8",
    customerEmail: "buyer@example.com",
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    packageName: "Private listing fee",
    recurring: false,
    linkType: "one-off",
    fingerprint: "listing-fingerprint",
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

describe("RIP-IDEM-001 / RIP-PRICE-001 listing fulfillment", () => {
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    paymentFindMany.mockResolvedValue([]);
    paymentCreate.mockResolvedValue({ id: "local-pay", listingId: "listing-1" });
    listingFindUnique.mockResolvedValue({
      id: "listing-1",
      status: "DRAFT",
      trustDeclarationAccepted: true,
      lifecycleRevision: 1,
      userId: "user-1",
    });
    listingImageCount.mockResolvedValue(2);
    transitionListingStatus.mockResolvedValue({
      listing: { id: "listing-1", status: "PENDING" },
      notification: {
        eventId: "event-1",
        listingId: "listing-1",
        action: "SUBMIT",
        fromStatus: "DRAFT",
        toStatus: "PENDING",
        reasonCode: null,
      },
    });
  });

  it("creates a listing payment once and submits the draft", async () => {
    await processProviderWebhookEvent(listingEvent());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(transitionListingStatus).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SUBMIT" }),
      expect.anything()
    );
    expect(dispatchListingNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ action: "SUBMIT", listingId: "listing-1" }),
    ]);

    paymentFindMany.mockResolvedValue([
      {
        id: "local-pay",
        listingId: "listing-1",
        lastProviderEventAt: new Date("2026-08-15T10:15:27.000Z"),
        lastProviderEventType: "payment.received",
        lastProviderEventFingerprint: "listing-fingerprint",
      },
    ]);
    await processProviderWebhookEvent(listingEvent());
    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(transitionListingStatus).toHaveBeenCalledOnce();
  });

  it("rejects listing amount drift", async () => {
    await expect(
      processProviderWebhookEvent(listingEvent({ amount: 500 }))
    ).rejects.toThrow("amount must be 499 pence");
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("rejects payment.success for a one-off product before mutation RIP-PRODUCT-002", async () => {
    await expect(
      processProviderWebhookEvent(
        listingEvent({
          type: "payment.succeeded",
          rawType: "payment.success",
        }),
      ),
    ).rejects.toThrow("only valid for recurring dealer products");
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(transitionListingStatus).not.toHaveBeenCalled();
  });

  it("fails closed without a listing reference", async () => {
    await expect(
      processProviderWebhookEvent(
        listingEvent({
          providerReference: null,
          metadata: {
            checkoutType: "listing_payment",
            listingId: null,
            dealerId: null,
            tier: null,
          },
        })
      )
    ).rejects.toThrow("Listing payment missing reference");
  });

  it("fails closed when payment identifiers match different rows RIP-IDEM-002", async () => {
    paymentFindMany.mockResolvedValueOnce([
      { id: "payment-by-id", listingId: "listing-1" },
      { id: "payment-by-reference", listingId: "listing-2" },
    ]);

    await expect(processProviderWebhookEvent(listingEvent())).rejects.toThrow(
      "Ambiguous Ripple payment correlation",
    );
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(transitionListingStatus).not.toHaveBeenCalled();
  });

  it("records delayed featured payment without featuring a non-live listing RIP-FEATURE-001", async () => {
    listingUpdateMany.mockResolvedValueOnce({ count: 0 });

    await processProviderWebhookEvent(
      listingEvent({
        providerReference: "v1:featured_upgrade:listing-1:nonce:mac",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.featured.code,
        amount: 500,
        linkCode: RIPPLE_CANONICAL_PRODUCTS.featured.code,
        packageName: "Featured listing upgrade",
        metadata: {
          checkoutType: "featured_upgrade",
          listingId: "listing-1",
          dealerId: null,
          tier: null,
        },
      }),
    );

    expect(paymentCreate).toHaveBeenCalledOnce();
    expect(listingUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "listing-1",
        status: "LIVE",
      }),
      data: { featured: true },
    });
    expect(transitionListingStatus).not.toHaveBeenCalled();
  });

  it("dispatches only after commit and isolates email failure MAIL-TXN-001", async () => {
    let releaseCommit: (() => void) | undefined;
    const commitBarrier = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    transactionMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const result = await fn(db);
      await commitBarrier;
      return result;
    });
    dispatchListingNotifications.mockRejectedValueOnce(new Error("mail unavailable"));

    const pending = processProviderWebhookEvent(listingEvent());
    await vi.waitFor(() => expect(transitionListingStatus).toHaveBeenCalledTimes(1));
    expect(dispatchListingNotifications).not.toHaveBeenCalled();

    releaseCommit?.();
    await expect(pending).resolves.toBeUndefined();
    expect(dispatchListingNotifications).toHaveBeenCalledTimes(1);
  });
});
