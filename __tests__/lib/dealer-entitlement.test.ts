import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  getAdminGrantState,
  getCurrentDealerEntitlement,
  getDealerEntitlement,
  getPaidSubscriptionEntitlementWhere,
  grantAdminDealerAccess,
  isPaidSubscriptionEntitled,
} from "@/lib/dealers/entitlement";

const NOW = new Date("2026-07-20T20:00:00.000Z");

describe("dealer entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a current admin grant for a dealer role and profile", async () => {
    mockDb.subscription.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "grant-1",
        source: "ADMIN_GRANT",
        grantEndsAt: new Date("2026-08-19T20:00:00.000Z"),
      });

    const entitlement = await getCurrentDealerEntitlement(
      {
        role: "DEALER",
        dealerProfile: { id: "dealer-1", tier: "STARTER" },
      },
      NOW
    );

    expect(entitlement).toEqual({
      subscriptionId: "grant-1",
      source: "ADMIN_GRANT",
      tier: "STARTER",
      endsAt: new Date("2026-08-19T20:00:00.000Z"),
    });
    expect(mockDb.subscription.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        dealerId: "dealer-1",
        ...getPaidSubscriptionEntitlementWhere(NOW),
      },
      select: { id: true, source: true, currentPeriodEnd: true },
    });
    expect(mockDb.subscription.findFirst).toHaveBeenLastCalledWith({
      where: {
        dealerId: "dealer-1",
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        revokedAt: null,
        grantStartsAt: { lte: NOW },
        grantEndsAt: { gt: NOW },
      },
      select: { id: true, source: true, grantEndsAt: true },
    });
  });

  it("keeps paid access until period end after cancel-at-period-end", () => {
    expect(
      isPaidSubscriptionEntitled(
        {
          status: "ACTIVE",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("ends paid access when a refund has no remaining paid period", () => {
    expect(
      isPaidSubscriptionEntitled(
        {
          status: "ACTIVE",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("blocks expired grants without a scheduled status update", async () => {
    mockDb.subscription.findFirst.mockResolvedValue(null);

    await expect(
      getDealerEntitlement("dealer-1", "STARTER", NOW)
    ).resolves.toBeNull();
    expect(
      getAdminGrantState(
        {
          status: "ACTIVE",
          grantStartsAt: new Date("2026-06-20T20:00:00.000Z"),
          grantEndsAt: NOW,
          revokedAt: null,
        },
        NOW
      )
    ).toBe("EXPIRED");
  });

  it("requires a dealer-capable role as well as an entitlement", async () => {
    await expect(
      getCurrentDealerEntitlement(
        {
          role: "USER",
          dealerProfile: { id: "dealer-1", tier: "STARTER" },
        },
        NOW
      )
    ).resolves.toBeNull();
    expect(mockDb.subscription.findFirst).not.toHaveBeenCalled();
  });

  it("gives active paid access precedence over a grant", async () => {
    mockDb.subscription.findFirst
      .mockResolvedValueOnce({
        id: "paid-1",
        source: "PAYMENT",
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "grant-1",
        source: "ADMIN_GRANT",
        grantEndsAt: new Date("2027-01-01T00:00:00.000Z"),
      });

    await expect(
      getDealerEntitlement("dealer-1", "PRO", NOW)
    ).resolves.toEqual({
      subscriptionId: "paid-1",
      source: "PAYMENT",
      tier: "PRO",
      endsAt: new Date("2026-08-01T00:00:00.000Z"),
    });
  });
});

describe("grantAdminDealerAccess", () => {
  it("does not overwrite or shorten an active paid subscription", async () => {
    const tx = {
      dealerProfile: {
        update: vi.fn(),
      },
      subscription: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: "paid-1" }),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(
      grantAdminDealerAccess(tx as never, {
        dealerId: "dealer-1",
        adminId: "admin-1",
        durationDays: 30,
        now: NOW,
      })
    ).resolves.toEqual({
      kind: "paid-access-preserved",
      subscription: { id: "paid-1" },
    });
    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.dealerProfile.update).not.toHaveBeenCalled();
  });

  it("creates a zero-payment admin source record with UTC-safe dates", async () => {
    const tx = {
      dealerProfile: {
        update: vi.fn().mockResolvedValue({ id: "dealer-1", tier: "STARTER" }),
      },
      subscription: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: "grant-1",
          ...data,
        })),
        update: vi.fn(),
      },
    };

    const result = await grantAdminDealerAccess(tx as never, {
      dealerId: "dealer-1",
      adminId: "admin-1",
      durationDays: 30,
      now: NOW,
    });

    expect(result.kind).toBe("granted");
    expect(tx.dealerProfile.update).toHaveBeenCalledWith({
      where: { id: "dealer-1" },
      data: { tier: "STARTER" },
    });
    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: {
        dealerId: "dealer-1",
        paymentProvider: "ADMIN",
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        currentPeriodEnd: new Date("2026-08-19T20:00:00.000Z"),
        grantStartsAt: NOW,
        grantEndsAt: new Date("2026-08-19T20:00:00.000Z"),
        grantedByAdminId: "admin-1",
        revokedAt: null,
      },
    });
  });
});
