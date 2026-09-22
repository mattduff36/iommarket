import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

const { transactionMock, dispatchMock, captureMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  dispatchMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: transactionMock },
}));
vi.mock("@/lib/email/listing-notifications", () => ({
  dispatchListingNotifications: dispatchMock,
}));
vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: captureMock,
  captureException: vi.fn(),
}));

function listingPaymentEvent(): NormalizedProviderWebhookEvent {
  return {
    id: "evt-pay-1",
    type: "payment.succeeded",
    rawType: "payment.succeeded",
    providerPaymentId: "pay_1",
    providerReference: "ref_1",
    providerSubscriptionId: null,
    providerPlanId: null,
    paymentStatus: "SUCCEEDED",
    subscriptionStatus: null,
    amount: RIPPLE_CANONICAL_PRODUCTS.listing.amountPence,
    currency: "GBP",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventTimestamp: new Date("2026-09-22T10:00:00.000Z"),
    clientId: "clientexample123",
    customerEmail: null,
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    packageName: null,
    recurring: false,
    linkType: "one-off",
    fingerprint: "evt-pay-1",
    metadata: {
      checkoutType: "listing_payment",
      listingId: "listing-1",
      dealerId: null,
      tier: null,
    },
    payload: {},
  };
}

describe("payment notification monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockResolvedValue([{ listingId: "listing-1" }]);
    captureMock.mockResolvedValue(null);
  });

  it("monitors an email failure without failing the committed payment", async () => {
    dispatchMock.mockRejectedValueOnce(new Error("mailbox unavailable"));
    const { handleOneOffPaymentReceived } = await import("@/lib/payments/webhook-payments");

    await expect(handleOneOffPaymentReceived(listingPaymentEvent())).resolves.toBeUndefined();
    expect(captureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "handleOneOffPaymentReceived",
        severity: "HIGH",
        tags: { checkoutType: "listing_payment" },
      }),
    );
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain("mailbox unavailable");
  });
});