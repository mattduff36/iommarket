import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), apply: vi.fn(), submit: vi.fn(), notify: vi.fn(), featured: vi.fn() }));
  vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/payments/webhook-payments", () => ({ createOrUpdateListingPayment: mocks.apply, submitPaidListingForReview: mocks.submit }));
vi.mock("@/lib/email/listing-notifications", () => ({ dispatchListingNotifications: mocks.notify }));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/payments/featured-entitlement", () => ({ applyPaidFeaturedEntitlement: mocks.featured }));
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
    mocks.apply.mockResolvedValue({ applied: true, payment: { id: context.paymentId, listingId: context.listingId } });
    mocks.submit.mockResolvedValue([]);
  });
  it("uses a verified receipt and signed checkout context in one serializable transaction", async () => {
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "confirmed", listingId: context.listingId });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: job, providerReference: context.merchantReference }), "SUCCEEDED", tx);
  });
  it("matches a featured payment and applies the upgrade without submitting a listing", async () => {
    const product = RIPPLE_CANONICAL_PRODUCTS.featured;
    context = { ...context, kind: "featured_upgrade", productCode: product.code };
    context.merchantReference = createRippleReference({ purpose: "featured_upgrade", targetId: context.listingId, linkCode: product.code });
    payment.providerReference = context.merchantReference;
    payment.type = "FEATURED";
    payment.amount = 500;
    inbox.linkCode = product.code;
    inbox.amountPence = 500;
    inbox.minimizedPayload = { ...(inbox.minimizedPayload as object), link_code: product.code, amount: 5 };
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "confirmed", listingId: context.listingId, checkoutType: "featured_upgrade" });
    expect(mocks.featured).toHaveBeenCalledWith(context.listingId, tx);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(tx.payment.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "FEATURED" }) }));
  });
  it("waits for webhook arrival without writing paid state", async () => {
    tx.paymentWebhookInbox.findMany.mockResolvedValue([]);
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "waiting" });
    expect(mocks.apply).not.toHaveBeenCalled();
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
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("returns idempotent confirmation only for the same owned payment", async () => {
    payment.status = "SUCCEEDED";
    payment.providerPaymentId = job;
    tx.payment.findUnique.mockResolvedValue(payment);
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "confirmed", listingId: context.listingId });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("retries an inbox claim race without writing paid state", async () => {
    tx.paymentWebhookInbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "waiting" });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("aborts transaction when pending payment reservation changes", async () => {
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "waiting" });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("keeps confirmed state when post-commit notification fails", async () => {
    mocks.submit.mockResolvedValue([{ kind: "test" }]);
    mocks.notify.mockRejectedValue(new Error("email service unavailable"));
    expect(await reconcileHostedReturn(context, job)).toEqual({ status: "confirmed", listingId: context.listingId });
  });
});
