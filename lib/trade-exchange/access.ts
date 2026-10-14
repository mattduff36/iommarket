import { db } from "@/lib/db";
import { classifyTradeActor, type TradeActor, type TradeDealerSubject } from "@/lib/trade-exchange/decision";
import { hasTradeProEntitlement, type TradeSubscriptionSnapshot } from "@/lib/trade-exchange/entitlement";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

const subscriptionSelect = {
  source: true,
  status: true,
  currentPeriodEnd: true,
  grantStartsAt: true,
  grantEndsAt: true,
  revokedAt: true,
  providerPlanId: true,
} as const;

export async function resolveTradeActor(user: TradeDealerSubject | null, now = new Date()): Promise<TradeActor> {
  if (!isTradeExchangeEnabled() || !user || user.role === "ADMIN" || user.role !== "DEALER" || !user.dealerProfile || user.disabledAt || user.deletedAt) {
    const membershipStatus = "NOT_APPLIED" as const;
    return classifyTradeActor({ enabled: isTradeExchangeEnabled(), user, membershipStatus, proEntitled: false });
  }
  const dealerId = user.dealerProfile.id;
  const [membership, subscriptions] = await Promise.all([
    db.tradeMembership.findUnique({ where: { dealerId }, select: { status: true } }),
    db.subscription.findMany({ where: { dealerId }, select: subscriptionSelect }),
  ]);
  return classifyTradeActor({
    enabled: true,
    user,
    membershipStatus: membership?.status ?? "NOT_APPLIED",
    proEntitled: hasTradeProEntitlement({
      tier: user.dealerProfile.tier,
      subscriptions: subscriptions as TradeSubscriptionSnapshot[],
      now,
    }),
  });
}

export async function listEligibleTradeDealerIds(now = new Date()): Promise<string[]> {
  if (!isTradeExchangeEnabled()) return [];
  const dealers = await db.dealerProfile.findMany({
    where: {
      tradeMembership: { status: "APPROVED" },
      user: { role: "DEALER", disabledAt: null, deletedAt: null },
    },
    select: { id: true, tier: true, subscriptions: { select: subscriptionSelect } },
  });
  return dealers
    .filter((dealer) => hasTradeProEntitlement({
      tier: dealer.tier,
      subscriptions: dealer.subscriptions as TradeSubscriptionSnapshot[],
      now,
    }))
    .map((dealer) => dealer.id);
}

export async function sellerIsEligible(dealerId: string, now = new Date()): Promise<boolean> {
  const eligible = await listEligibleTradeDealerIds(now);
  return eligible.includes(dealerId);
}
