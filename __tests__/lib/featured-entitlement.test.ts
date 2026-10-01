import { describe, expect, it, vi } from "vitest";
import { applyPaidFeaturedEntitlement } from "@/lib/payments/featured-entitlement";

function client(featured = false) {
  return {
    listing: {
      findFirst: vi.fn().mockResolvedValue({ id: "listing-1", featured }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue({ id: "payment-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as never as Parameters<typeof applyPaidFeaturedEntitlement>[1] & {
    listing: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    payment: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  };
}

describe("paid Featured entitlement", () => {
  it("defers a pending listing without consuming its paid entitlement", async () => {
    const tx = client();
    tx.listing.findFirst.mockResolvedValue(null);

    await expect(applyPaidFeaturedEntitlement("listing-1", tx)).resolves.toBe(false);
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("does not consume a payment when another source already featured the listing", async () => {
    const tx = client(true);

    await expect(applyPaidFeaturedEntitlement("listing-1", tx)).resolves.toBe(false);
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("claims one unrefunded, unapplied entitlement and applies it atomically", async () => {
    const tx = client();

    await expect(applyPaidFeaturedEntitlement("listing-1", tx)).resolves.toBe(true);
    expect(tx.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "SUCCEEDED", refundedAt: null, featuredAppliedAt: null }),
    }));
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "payment-1", refundedAt: null, featuredAppliedAt: null }),
    }));
    expect(tx.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "listing-1", featured: false }),
      data: { featured: true },
    }));
  });

  it("does not feature the listing when the entitlement claim loses a race", async () => {
    const tx = client();
    tx.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(applyPaidFeaturedEntitlement("listing-1", tx)).resolves.toBe(false);
    expect(tx.listing.updateMany).not.toHaveBeenCalled();
  });
});
