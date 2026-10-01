import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

const { transaction, update } = vi.hoisted(() => ({
  transaction: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: transaction } }));
vi.mock("@/lib/email/listing-notifications", () => ({ dispatchListingNotifications: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureBusinessEvent: vi.fn(), captureException: vi.fn() }));

function event(): NormalizedProviderWebhookEvent {
  const product = RIPPLE_CANONICAL_PRODUCTS.listingAndFeatured;
  return {
    id: "evt-late-success", type: "payment.received", rawType: "payment.received",
    providerPaymentId: "provider-payment-new", providerReference: "signed-bundle-reference",
    providerSubscriptionId: null, providerPlanId: null, paymentStatus: "SUCCEEDED",
    subscriptionStatus: null, amount: product.amountPence, currency: "gbp",
    currentPeriodEnd: null, cancelAtPeriodEnd: null, eventTimestamp: new Date(),
    clientId: "client", customerEmail: null, linkCode: product.code, packageName: null,
    recurring: false, linkType: "one-off", fingerprint: "evt-late-success",
    metadata: { checkoutType: "listing_and_featured", listingId: "listing-1", dealerId: null, tier: null },
    payload: {},
  };
}

describe("terminal Ripple payment protections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { status: "REFUNDED", refundedAt: new Date("2026-09-30T12:00:00Z") },
    { status: "SUCCEEDED", refundedAt: new Date("2026-09-30T12:00:00Z") },
  ])("does not resurrect or fulfill a refunded combined purchase ($status)", async (terminal) => {
    const existing = {
      id: "payment-1", listingId: "listing-1", status: terminal.status,
      refundedAt: terminal.refundedAt, providerPaymentId: "provider-payment-old",
      providerReference: "signed-bundle-reference", paymentProvider: "RIPPLE",
    };
    const tx = { payment: { findMany: vi.fn().mockResolvedValue([existing]), update } };
    transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const { handleOneOffPaymentReceived } = await import("@/lib/payments/webhook-payments");
    await expect(handleOneOffPaymentReceived(event())).resolves.toBeUndefined();

    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a second provider payment ID for the same signed checkout reference", async () => {
    const existing = {
      id: "payment-1", listingId: "listing-1", status: "PENDING", refundedAt: null,
      providerPaymentId: "provider-payment-old", providerReference: "signed-bundle-reference",
      paymentProvider: "RIPPLE",
    };
    const tx = { payment: { findMany: vi.fn().mockResolvedValue([existing]), update } };
    transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const { handleOneOffPaymentReceived } = await import("@/lib/payments/webhook-payments");
    await expect(handleOneOffPaymentReceived(event())).rejects.toThrow("subscription charge collision");
    expect(update).not.toHaveBeenCalled();
  });
});
