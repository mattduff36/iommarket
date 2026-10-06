import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  reconcile: vi.fn(),
  notify: vi.fn(),
  observe: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/email/listing-notifications", () => ({ dispatchListingNotifications: mocks.notify }));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: mocks.capture }));
vi.mock("@/lib/payments/reconcile-payment", () => ({
  reconcileListingPaymentInTransaction: mocks.reconcile,
  PaymentReconciliationError: class PaymentReconciliationError extends Error {},
}));
vi.mock("@/lib/payments/checkout-attempts", () => ({
  recordHostedReturnObservation: mocks.observe,
}));

import { reconcileHostedReturn, type HostedReturnContext } from "@/lib/payments/reconcile-hosted-return";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { installRippleTestEnv, rippleEnvelope } from "./ripple-test-env";

describe("authenticated hosted return reconciliation", () => {
  let context: Exclude<HostedReturnContext, { kind: "dealer_subscription" }>;
  let payment: Record<string, unknown>;
  let inbox: Record<string, unknown>;
  let tx: {
    payment: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    paymentWebhookInbox: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    subscriptionCharge: { findUnique: ReturnType<typeof vi.fn> };
  };
  const job = "260921004609311316";

  function useFeaturedCheckout() {
    const product = RIPPLE_CANONICAL_PRODUCTS.featured;
    context = { ...context, kind: "featured_upgrade", productCode: product.code };
    context.merchantReference = createRippleReference({
      purpose: "featured_upgrade",
      targetId: context.listingId,
      linkCode: product.code,
    });
    payment.providerReference = context.merchantReference;
    payment.type = "FEATURED";
    payment.amount = 500;
    inbox.linkCode = product.code;
    inbox.amountPence = 500;
    inbox.minimizedPayload = {
      ...(inbox.minimizedPayload as object),
      link_code: product.code,
      amount: 5,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    installRippleTestEnv();
    const now = Date.now();
    context = {
      userId: "user-1",
      email: "buyer@example.com",
      paymentId: "pending-1",
      listingId: "listing-1",
      issuedAt: now - 10_000,
      merchantReference: createRippleReference({
        purpose: "listing_payment",
        targetId: "listing-1",
        linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
      }),
    };
    payment = {
      id: context.paymentId,
      listingId: context.listingId,
      listing: { userId: context.userId },
      providerReference: context.merchantReference,
      paymentProvider: "RIPPLE",
      type: "LISTING",
      includesFeatured: false,
      amount: 499,
      currency: "gbp",
      refundedAt: null,
      status: "PENDING",
      providerPaymentId: null,
    };
    const parsed = parseRippleWebhookEnvelope(rippleEnvelope({
      timestamp: new Date(now - 1_000).toISOString(),
      data: { payment_reference: job },
    }));
    inbox = {
      id: "inbox-1",
      status: "FAILED",
      lastErrorCode: "MISSING_REFERENCE",
      attemptCount: 1,
      eventType: "payment.received",
      clientId: parsed.event.clientId,
      paymentReference: job,
      merchantReference: null,
      linkCode: parsed.event.linkCode,
      amountPence: 499,
      currency: "gbp",
      recurring: false,
      linkType: "one-off",
      customerEmailNorm: "buyer@example.com",
      eventTimestamp: parsed.event.eventTimestamp,
      createdAt: new Date(now),
      minimizedPayload: parsed.minimized,
    };
    tx = {
      payment: {
        findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id ? payment : null)),
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      paymentWebhookInbox: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve([inbox])),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionCharge: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.reconcile.mockResolvedValue({ notifications: [] });
    mocks.observe.mockResolvedValue(null);
    mocks.notify.mockResolvedValue(undefined);
  });

  it("correlates a verified missing-reference receipt with the signed checkout", async () => {
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, expect.objectContaining({
      paymentId: context.paymentId,
      merchantReference: context.merchantReference,
      providerPaymentId: job,
      evidence: expect.objectContaining({
        type: "VERIFIED_WEBHOOK",
        evidenceId: "inbox-1",
        snapshot: expect.objectContaining({
          correlation: "signed_hosted_return_and_verified_webhook",
          webhookOmittedMerchantReference: true,
          paymentReference: job,
        }),
      }),
      event: expect.objectContaining({
        providerPaymentId: job,
        providerReference: context.merchantReference,
        metadata: expect.objectContaining({
          checkoutType: "listing_payment",
          listingId: context.listingId,
        }),
      }),
    }));
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentWebhookInbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ status: "PROCESSING" }),
    }));
    expect(tx.paymentWebhookInbox.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: "PROCESSED" }),
    }));
  });

  it("confirms a Featured upgrade without treating it as a new listing payment", async () => {
    useFeaturedCheckout();
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
      checkoutType: "featured_upgrade",
    });
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, expect.objectContaining({
      event: expect.objectContaining({
        metadata: expect.objectContaining({ checkoutType: "featured_upgrade" }),
      }),
    }));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("waits for the webhook and confirms on the next poll", async () => {
    tx.paymentWebhookInbox.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([inbox]);

    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({ status: "waiting" });
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a payment job reference without a verified webhook", async () => {
    tx.paymentWebhookInbox.findMany.mockResolvedValue([]);
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({ status: "waiting" });
    expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({
      providerPaymentId: job,
      merchantReference: context.merchantReference,
    }));
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "PROCESSING"])("waits for %s webhook processing", async (status) => {
    inbox.status = status;
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({ status: "waiting" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    "owner",
    "email",
    "stale",
    "competing",
    "refund",
    "failed",
    "tamper",
    "job",
    "old-receipt",
    "amount",
    "product",
    "currency",
    "recurring",
    "client",
    "local-refund",
    "duplicate",
    "subscription",
  ])("rejects %s without credit", async (condition) => {
    if (condition === "owner") payment.listing = { userId: "other-user" };
    if (condition === "email") inbox.customerEmailNorm = "someone@example.com";
    if (condition === "stale") context.issuedAt = Date.now() - 31 * 60_000;
    if (condition === "competing") tx.payment.count.mockResolvedValue(2);
    if (condition === "refund") {
      tx.paymentWebhookInbox.findMany.mockResolvedValue([inbox, { ...inbox, eventType: "payment.refunded" }]);
    }
    if (condition === "failed") inbox.eventType = "payment.failed";
    if (condition === "tamper") context.merchantReference += "tampered";
    if (condition === "job") inbox.paymentReference = "123";
    if (condition === "old-receipt") inbox.eventTimestamp = new Date(context.issuedAt - 6_000);
    if (condition === "amount") inbox.amountPence = 50;
    if (condition === "product") inbox.linkCode = RIPPLE_CANONICAL_PRODUCTS.featured.code;
    if (condition === "currency") inbox.currency = "eur";
    if (condition === "recurring") inbox.recurring = true;
    if (condition === "client") inbox.clientId = "another-merchant";
    if (condition === "local-refund") payment.refundedAt = new Date();
    if (condition === "duplicate") {
      tx.payment.findUnique.mockImplementation(({ where }) => Promise.resolve(
        where.id ? payment : { id: "another-payment" },
      ));
    }
    if (condition === "subscription") tx.subscriptionCharge.findUnique.mockResolvedValue({ id: "charge" });

    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({ status: "review" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("keeps an already attested payment confirmed without a second reconciliation", async () => {
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = job;
    tx.payment.findUnique.mockResolvedValue(payment);

    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(tx.paymentWebhookInbox.updateMany).not.toHaveBeenCalled();
  });

  it("does not create a second reconciliation when the success page polls again", async () => {
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = job;
    tx.payment.findUnique.mockResolvedValue(payment);

    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it("waits without paying when the inbox claim loses a race", async () => {
    tx.paymentWebhookInbox.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({ status: "waiting" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("dispatches listing notifications after the reconciliation commits", async () => {
    mocks.reconcile.mockResolvedValue({ notifications: [{ kind: "submitted" }] });
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.notify).toHaveBeenCalledWith([{ kind: "submitted" }]);
  });

  it("still confirms when the notification email fails", async () => {
    mocks.reconcile.mockResolvedValue({ notifications: [{ kind: "submitted" }] });
    mocks.notify.mockRejectedValue(new Error("email service unavailable"));
    await expect(reconcileHostedReturn(context, job)).resolves.toEqual({
      status: "confirmed",
      listingId: context.listingId,
    });
    expect(mocks.capture).toHaveBeenCalled();
  });
});
