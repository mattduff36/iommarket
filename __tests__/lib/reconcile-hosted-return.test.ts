import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  reconcile: vi.fn(),
  notify: vi.fn(),
  observe: vi.fn(),
}));
  vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/email/listing-notifications", () => ({ dispatchListingNotifications: mocks.notify }));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/payments/reconcile-payment", () => ({
  reconcileListingPaymentInTransaction: mocks.reconcile,
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
    listing?: { updateMany: ReturnType<typeof vi.fn> };
  };
  const job = "260921004609311316";
  beforeEach(() => {
    vi.clearAllMocks();
    installRippleTestEnv();
    const now = Date.now();
    context = { userId: "user-1", email: "buyer@example.com", paymentId: "pending-1", listingId: "listing-1", issuedAt: now - 10_000, merchantReference: createRippleReference({ purpose: "listing_payment", targetId: "listing-1", linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code }) };
    payment = { id: context.paymentId, listingId: context.listingId, listing: { userId: context.userId }, providerReference: context.merchantReference, paymentProvider: "RIPPLE", type: "LISTING", includesFeatured: false, amount: 499, currency: "gbp", refundedAt: null, status: "PENDING", providerPaymentId: null };
    const parsed = parseRippleWebhookEnvelope(rippleEnvelope({ timestamp: new Date(now - 1_000).toISOString(), data: { payment_reference: job } }));
    inbox = { id: "inbox-1", status: "FAILED", lastErrorCode: "MISSING_REFERENCE", attemptCount: 1, eventType: "payment.received", clientId: parsed.event.clientId, paymentReference: job, merchantReference: null, linkCode: parsed.event.linkCode, amountPence: 499, currency: "gbp", recurring: false, linkType: "one-off", customerEmailNorm: "buyer@example.com", eventTimestamp: parsed.event.eventTimestamp, createdAt: new Date(now), minimizedPayload: parsed.minimized };
    tx = { payment: { findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id ? payment : null)), count: vi.fn().mockResolvedValue(1), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, paymentWebhookInbox: { findMany: vi.fn().mockImplementation(() => Promise.resolve([inbox])), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, subscriptionCharge: { findUnique: vi.fn().mockResolvedValue(null) } };
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.reconcile.mockResolvedValue({ notifications: [] });
    mocks.observe.mockResolvedValue(null);
  });
  it("does not convert a failed inbox receipt into paid state from browser context", async () => {
    expect(await reconcileHostedReturn(context, job)).toEqual({
      status: "review",
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("records Featured return evidence without applying the upgrade", async () => {
    const product = RIPPLE_CANONICAL_PRODUCTS.featured;
    context = { ...context, kind: "featured_upgrade", productCode: product.code };
    context.merchantReference = createRippleReference({ purpose: "featured_upgrade", targetId: context.listingId, linkCode: product.code });
    payment.providerReference = context.merchantReference;
    payment.type = "FEATURED";
    payment.amount = 500;
    inbox.linkCode = product.code;
    inbox.amountPence = 500;
    inbox.minimizedPayload = { ...(inbox.minimizedPayload as object), link_code: product.code, amount: 5 };
    expect(await reconcileHostedReturn(context, job)).toEqual({
      status: "review",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("waits for webhook arrival without writing paid state", async () => {
    tx.paymentWebhookInbox.findMany.mockResolvedValue([]);
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "waiting" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "PROCESSING"])("waits for %s webhook processing", async (status) => {
    inbox.status = status;
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "waiting" });
  });
  it.each(["owner", "email", "stale", "competing", "refund", "tamper", "job", "old-receipt", "amount", "product", "recurring", "client", "local-refund", "duplicate", "subscription"])("rejects %s without credit", async (condition) => {
    if (condition === "owner") payment.listing = { userId: "other-user" };
    if (condition === "email") inbox.customerEmailNorm = "someone@example.com";
    if (condition === "stale") context.issuedAt = Date.now() - 31 * 60_000;
    if (condition === "competing") tx.payment.count.mockResolvedValue(2);
    if (condition === "refund") tx.paymentWebhookInbox.findMany.mockResolvedValue([inbox, { ...inbox, eventType: "payment.refunded" }]);
    if (condition === "tamper") context.merchantReference += "tampered";
    if (condition === "job") inbox.paymentReference = "123";
    if (condition === "old-receipt") inbox.eventTimestamp = new Date(context.issuedAt - 6_000);
    if (condition === "amount") inbox.amountPence = 50;
    if (condition === "product") inbox.linkCode = RIPPLE_CANONICAL_PRODUCTS.featured.code;
    if (condition === "recurring") inbox.recurring = true;
    if (condition === "client") inbox.clientId = "another-merchant";
    if (condition === "local-refund") payment.refundedAt = new Date();
    if (condition === "duplicate") tx.payment.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id ? payment : { id: "another-payment" }));
    if (condition === "subscription") tx.subscriptionCharge.findUnique.mockResolvedValue({ id: "charge" });
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "review" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("returns idempotent confirmation only for the same owned payment", async () => {
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = job;
    tx.payment.findUnique.mockResolvedValue(payment);
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "confirmed", listingId: context.listingId });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("does not claim a failed inbox row", async () => {
    tx.paymentWebhookInbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "review" });
    expect(tx.paymentWebhookInbox.updateMany).not.toHaveBeenCalled();
  });
  it("does not reserve a provider ID from a browser return", async () => {
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "review" });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
  it("does not dispatch fulfillment notifications from browser evidence", async () => {
    mocks.reconcile.mockResolvedValue({ notifications: [{ kind: "test" }] });
    mocks.notify.mockRejectedValue(new Error("email service unavailable"));
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "review" });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
