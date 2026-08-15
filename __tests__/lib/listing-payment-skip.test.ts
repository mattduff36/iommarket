import { beforeEach, describe, expect, it, vi } from "vitest";
import { canSkipListingPayment } from "@/lib/listings/payment-skip";

describe("listing payment skip ALR-PAY-001 ALR-RESUB-001", () => {
  const client = {
    subscription: { findFirst: vi.fn() },
    payment: { findFirst: vi.fn() },
    freeListingClaim: { findUnique: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.subscription.findFirst.mockResolvedValue(null);
    client.payment.findFirst.mockResolvedValue(null);
    client.freeListingClaim.findUnique.mockResolvedValue(null);
  });

  it("skips when a succeeded listing payment exists", async () => {
    client.payment.findFirst.mockResolvedValue({ id: "pay-1" });
    await expect(
      canSkipListingPayment(client as never, {
        listingId: "listing-1",
        userId: "user-1",
        dealerId: null,
      }),
    ).resolves.toEqual({ skip: true, reason: "paid" });
    expect(client.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SUCCEEDED", type: "LISTING" }),
      }),
    );
  });

  it("skips when the matching free listing claim exists", async () => {
    client.freeListingClaim.findUnique.mockResolvedValue({
      id: "claim-1",
      userId: "user-1",
    });
    await expect(
      canSkipListingPayment(client as never, {
        listingId: "listing-1",
        userId: "user-1",
        dealerId: null,
      }),
    ).resolves.toEqual({ skip: true, reason: "claimed" });
  });

  it("does not skip refunded or ineligible listings", async () => {
    await expect(
      canSkipListingPayment(client as never, {
        listingId: "listing-1",
        userId: "user-1",
        dealerId: null,
      }),
    ).resolves.toEqual({ skip: false, reason: "ineligible" });
  });

  it("skips when the dealer has an active entitlement ALR-RESUB-001", async () => {
    client.subscription.findFirst.mockResolvedValue({ id: "sub-1" });
    await expect(
      canSkipListingPayment(client as never, {
        listingId: "listing-1",
        userId: "user-1",
        dealerId: "dealer-1",
      }),
    ).resolves.toEqual({ skip: true, reason: "dealer" });
  });
});
