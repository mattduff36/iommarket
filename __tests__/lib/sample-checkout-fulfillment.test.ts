import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitPaidListingForReviewMock } = vi.hoisted(() => ({
  submitPaidListingForReviewMock: vi.fn(),
}));

vi.mock("@/lib/payments/webhook-payments", () => ({
  submitPaidListingForReview: submitPaidListingForReviewMock,
}));

import { fulfillSampleCheckout } from "@/lib/payments/sample-checkout-fulfillment";

function makeTx() {
  return {
    payment: { updateMany: vi.fn(async () => ({ count: 1 })) },
    listing: { update: vi.fn() },
    subscription: { upsert: vi.fn(async () => ({ id: "dev-subscription-1" })) },
    subscriptionCharge: { create: vi.fn() },
    dealerProfile: { update: vi.fn() },
    user: { updateMany: vi.fn() },
  };
}

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    id: "sample-1", userId: "user-1", kind: "listing_payment", targetId: "listing-1",
    description: "Listing payment", amountPence: 499, currency: "gbp", tier: null,
    status: "PENDING", attemptCount: 0, returnUrl: "/sell/checkout",
    expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

describe("sample checkout fulfillment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes listing payment changes to DEV and reuses paid-listing moderation", async () => {
    const tx = makeTx();
    await fulfillSampleCheckout(tx as never, checkout() as never, "SUCCEEDED", 1);
    const [update] = tx.payment.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
    expect(update.where).toMatchObject({
      providerReference: "sim_sample-1", paymentProvider: "DEV", listingId: "listing-1",
      status: { in: ["PENDING", "FAILED"] },
    });
    expect(update.data).toMatchObject({ status: "SUCCEEDED", providerPaymentId: "sim_sample-1_1" });
    expect(submitPaidListingForReviewMock).toHaveBeenCalledTimes(1);
    const moderationCall = submitPaidListingForReviewMock.mock.calls[0] as unknown as [string, Record<string, unknown>, unknown];
    expect(moderationCall[0]).toBe("listing-1");
    expect(moderationCall[1]).toMatchObject({
      type: "payment.received", providerReference: "sim_sample-1", providerPaymentId: "sim_sample-1_1",
      payload: { simulated: true },
    });
    expect(moderationCall[2]).toBe(tx);
  });

  it("records a decline without invoking paid-listing moderation", async () => {
    const tx = makeTx();
    await fulfillSampleCheckout(tx as never, checkout() as never, "FAILED", 1);
    const update = (tx.payment.updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown>; data: Record<string, unknown> }])[0];
    expect(update).toMatchObject({
      where: { paymentProvider: "DEV" }, data: { status: "FAILED" },
    });
    expect(submitPaidListingForReviewMock).not.toHaveBeenCalled();
  });

  it("creates only DEV subscription state and a distinct charge for a successful attempt", async () => {
    const tx = makeTx();
    const row = checkout({ kind: "dealer_subscription", targetId: "dealer-1", tier: "PRO", amountPence: 4999 });
    await fulfillSampleCheckout(tx as never, row as never, "SUCCEEDED", 2);
    const upsert = (tx.subscription.upsert.mock.calls[0] as unknown as [{ where: Record<string, unknown>; create: Record<string, unknown> }])[0];
    expect(upsert.where).toEqual({ providerSubscriptionId: "sim_sample-1" });
    expect(upsert.create).toMatchObject({
      paymentProvider: "DEV", source: "PAYMENT", providerPlanId: "sim_pro", status: "ACTIVE",
      providerLifecycle: "ACTIVE", lastProviderEventFingerprint: "sim_sample-1_2",
    });
    const charge = (tx.subscriptionCharge.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0];
    expect(charge).toMatchObject({
      data: { subscriptionId: "dev-subscription-1", paymentReference: "sim_sample-1_2", amount: 4999, currency: "gbp" },
    });
    expect(tx.dealerProfile.update).toHaveBeenCalledWith({ where: { id: "dealer-1" }, data: { tier: "PRO" } });
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: "user-1", role: "USER" }, data: { role: "DEALER" } });
  });

  it("does not grant access or create a charge for a declined subscription", async () => {
    const tx = makeTx();
    await fulfillSampleCheckout(tx as never, checkout({
      kind: "dealer_subscription", targetId: "dealer-1", tier: "STARTER",
    }) as never, "FAILED", 1);
    const upsert = (tx.subscription.upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown> }])[0];
    expect(upsert.create).toMatchObject({
      paymentProvider: "DEV", status: "INCOMPLETE", providerLifecycle: "NONE",
    });
    expect(tx.subscriptionCharge.create).not.toHaveBeenCalled();
    expect(tx.dealerProfile.update).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
