import { describe, expect, it } from "vitest";
import {
  DRAFT_COUNT,
  LIVE_COUNT,
  PENDING_COUNT,
  SOLD_COUNT,
} from "../../prisma/seed/constants";
import { countActiveListings } from "../../prisma/seed/caps";
import {
  assertMarketplacePlan,
  buildMarketplacePlan,
} from "../../prisma/seed/dataset";
import { DEALER_TIER_CAPS } from "../../lib/config/dealer-tiers";
import {
  assertSyntheticFinancialRow,
  seedPaymentId,
  seedPlanId,
  seedSubscriptionId,
} from "../../prisma/seed/payments";

const NOW = new Date("2026-08-16T09:00:00.000Z");

const preserved = {
  preservedDealers: [
    {
      userId: "user-matt",
      dealerId: "dealer-matt",
      slug: "matt-test",
      name: "Matt Duffill TEST",
      tier: "STARTER" as const,
      verified: true,
    },
    {
      userId: "user-morris",
      dealerId: "dealer-morris",
      slug: "morris-motors",
      name: "Morris motors",
      tier: "PRO" as const,
      verified: true,
    },
  ],
  preservedUsers: [
    {
      id: "user-matt",
      email: "matt@example.com",
      name: "Matt",
      role: "DEALER",
    },
    {
      id: "user-morris",
      email: "morris@example.com",
      name: "Morris",
      role: "ADMIN",
    },
    {
      id: "user-admin",
      email: "admin@mpdee.co.uk",
      name: "Admin",
      role: "ADMIN",
    },
    {
      id: "user-private",
      email: "buyer@example.com",
      name: "Buyer",
      role: "USER",
    },
  ],
  now: NOW,
};

describe("SEED-ENTITLE-001 SEED-CAP-001 SEED-MIX-001 SEED-PAYMENT-001 SEED-IDEMPOTENT-001", () => {
  it("builds a deterministic entitled cap-safe mix", () => {
    const first = buildMarketplacePlan(preserved);
    const second = buildMarketplacePlan(preserved);

    expect(first).toEqual(second);
    expect(() => assertMarketplacePlan(first, NOW)).not.toThrow();
    expect(first.listings.filter((listing) => listing.status === "LIVE")).toHaveLength(
      LIVE_COUNT,
    );
    expect(first.listings.filter((listing) => listing.status === "SOLD")).toHaveLength(
      SOLD_COUNT,
    );
    expect(first.listings.filter((listing) => listing.status === "PENDING")).toHaveLength(
      PENDING_COUNT,
    );
    expect(first.listings.filter((listing) => listing.status === "DRAFT")).toHaveLength(
      DRAFT_COUNT,
    );
    expect(first.reviews.some((review) => review.status === "APPROVED")).toBe(true);
    expect(first.dealers).toHaveLength(12);
    expect(first.dealers.filter((dealer) => dealer.tier === "PRO")).toHaveLength(4);
    expect(first.dealers.filter((dealer) => dealer.tier === "STARTER")).toHaveLength(8);
    expect(first.dealers.some((dealer) => !dealer.verified)).toBe(true);
    expect(first.dealers.some((dealer) => dealer.entitlement === "ADMIN_GRANT")).toBe(
      true,
    );

    for (const dealer of first.dealers) {
      const active = countActiveListings(first.listings, dealer.key);
      expect(active).toBeLessThanOrEqual(DEALER_TIER_CAPS[dealer.tier]);
      expect(() =>
        assertSyntheticFinancialRow({
          paymentProvider: "DEV",
          providerSubscriptionId: seedSubscriptionId(dealer.slug),
          providerPlanId: seedPlanId(dealer.tier),
          customerEmailNorm: null,
        }),
      ).not.toThrow();
    }

    expect(seedPaymentId("live-p-001").startsWith("seed:demo:")).toBe(true);
    expect(() =>
      assertSyntheticFinancialRow({
        paymentProvider: "RIPPLE",
        providerPaymentId: seedPaymentId("x"),
      }),
    ).toThrow("DEV");
  });

  it("keeps preserved dealer identity keys stable across reruns", () => {
    const plan = buildMarketplacePlan(preserved);
    expect(plan.dealers[0]?.preservedUserId).toBe("user-matt");
    expect(plan.dealers[1]?.preservedDealerId).toBe("dealer-morris");
    expect(plan.listings.some((listing) => listing.sellerKey === "preserved-user-user-private")).toBe(
      true,
    );
  });
});
