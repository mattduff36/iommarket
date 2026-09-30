import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { reconcileHostedSubscriptionReturn } from "@/lib/payments/reconcile-hosted-subscription-return";
import type { HostedReturnContext } from "@/lib/payments/hosted-return-context";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import { parseRippleWebhookEnvelope } from "@/lib/payments/ripple-contract";
import { installRippleTestEnv, rippleEnvelope } from "./ripple-test-env";

describe("hosted subscription confirmation", () => {
  const job = "260921004609311316";
  const product = RIPPLE_CANONICAL_PRODUCTS.starter;
  let context: Extract<HostedReturnContext, { kind: "dealer_subscription" }>;
  let inbox: Record<string, unknown>;
  let subscription: Record<string, unknown>;
  let tx: {
    dealerProfile: { findUnique: ReturnType<typeof vi.fn> };
    paymentWebhookInbox: { findMany: ReturnType<typeof vi.fn> };
    payment: { findUnique: ReturnType<typeof vi.fn> };
    subscriptionCharge: { findUnique: ReturnType<typeof vi.fn> };
  };
  beforeEach(() => {
    vi.clearAllMocks();
    installRippleTestEnv();
    const now = Date.now();
    context = { kind: "dealer_subscription", userId: "user-1", email: "buyer@example.com", dealerId: "dealer-1", productCode: product.code, issuedAt: now - 10_000, merchantReference: createRippleReference({ purpose: "dealer_subscription", targetId: "dealer-1", linkCode: product.code, tier: "STARTER" }) };
    const parsed = parseRippleWebhookEnvelope(rippleEnvelope({ timestamp: new Date(now - 1000).toISOString(), data: { link_code: product.code, amount: 29.99, recurring: true, link_type: "subscription", payment_reference: job } }));
    inbox = { status: "PROCESSED", eventType: "payment.received", clientId: parsed.event.clientId, linkCode: product.code, amountPence: 2999, currency: "gbp", recurring: true, customerEmailNorm: context.email, eventTimestamp: parsed.event.eventTimestamp, createdAt: new Date(now), minimizedPayload: parsed.minimized };
    subscription = { id: "sub-1", dealerId: context.dealerId, paymentProvider: "RIPPLE", source: "PAYMENT", providerPlanId: product.code, customerEmailNorm: context.email, status: "ACTIVE", currentPeriodEnd: new Date(now + 86400_000), revokedAt: null };
    tx = {
      dealerProfile: { findUnique: vi.fn().mockResolvedValue({ userId: context.userId }) },
      paymentWebhookInbox: { findMany: vi.fn().mockImplementation(() => Promise.resolve([inbox])) },
      payment: { findUnique: vi.fn().mockResolvedValue(null) },
      subscriptionCharge: { findUnique: vi.fn().mockImplementation(() => Promise.resolve({ amount: 2999, currency: "gbp", eventTimestamp: new Date(now - 1000), subscription })) },
    };
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });
  it("confirms only the exact verified charge already credited to the owned dealer", async () => {
    expect(await reconcileHostedSubscriptionReturn(context, job)).toEqual({ status: "confirmed", checkoutType: "dealer_subscription" });
    expect(tx.subscriptionCharge.findUnique).toHaveBeenCalledWith({ where: { paymentReference: job }, include: { subscription: true } });
  });
  it("waits for asynchronous webhook processing", async () => {
    inbox.status = "PROCESSING";
    expect(await reconcileHostedSubscriptionReturn(context, job)).toEqual({ status: "waiting" });
    expect(tx.subscriptionCharge.findUnique).not.toHaveBeenCalled();
  });
  it.each(["owner", "email", "product", "amount", "stale", "tamper", "expired", "adverse", "assigned", "charge-owner", "charge-product"])("rejects %s evidence", async (condition) => {
    if (condition === "owner") tx.dealerProfile.findUnique.mockResolvedValue({ userId: "other" });
    if (condition === "email") inbox.customerEmailNorm = "other@example.com";
    if (condition === "product") inbox.linkCode = RIPPLE_CANONICAL_PRODUCTS.pro.code;
    if (condition === "amount") inbox.amountPence = 100;
    if (condition === "stale") inbox.eventTimestamp = new Date(context.issuedAt - 10_000);
    if (condition === "tamper") context.merchantReference += "x";
    if (condition === "expired") subscription.currentPeriodEnd = new Date(0);
    if (condition === "adverse") tx.paymentWebhookInbox.findMany.mockResolvedValue([inbox, { eventType: "payment.failed" }]);
    if (condition === "assigned") tx.payment.findUnique.mockResolvedValue({ id: "other-payment" });
    if (condition === "charge-owner") subscription.dealerId = "other-dealer";
    if (condition === "charge-product") subscription.providerPlanId = RIPPLE_CANONICAL_PRODUCTS.pro.code;
    expect(await reconcileHostedSubscriptionReturn(context, job)).toEqual({ status: "review" });
  });
});
