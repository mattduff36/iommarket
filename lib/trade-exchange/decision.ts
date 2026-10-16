import type { TradeListingStatus, TradeMembershipStatus } from "@prisma/client";

export type TradeMembershipViewStatus = TradeMembershipStatus | "NOT_APPLIED";

export interface TradeDealerSubject {
  id: string;
  role: "USER" | "DEALER" | "ADMIN";
  disabledAt: Date | null;
  deletedAt: Date | null;
  dealerProfile: { id: string; name: string; tier: "STARTER" | "PRO" } | null;
}

export type TradeActor =
  | { kind: "disabled" }
  | { kind: "anonymous" }
  | { kind: "denied" }
  | {
      kind: "applicant";
      userId: string;
      dealerId: string;
      dealerName: string;
      tier: "STARTER" | "PRO";
      membershipStatus: TradeMembershipViewStatus;
      proEntitled: boolean;
    }
  | { kind: "member"; userId: string; dealerId: string; dealerName: string }
  | { kind: "admin"; userId: string };

export function classifyTradeActor(input: {
  enabled: boolean;
  user: TradeDealerSubject | null;
  membershipStatus: TradeMembershipViewStatus;
  proEntitled: boolean;
}): TradeActor {
  if (!input.enabled) return { kind: "disabled" };
  const user = input.user;
  if (!user) return { kind: "anonymous" };
  if (user.disabledAt || user.deletedAt) return { kind: "denied" };
  if (user.role === "ADMIN") return { kind: "admin", userId: user.id };
  if (user.role !== "DEALER" || !user.dealerProfile) return { kind: "denied" };
  const eligible = input.proEntitled && input.membershipStatus === "APPROVED";
  if (!eligible) {
    return {
      kind: "applicant",
      userId: user.id,
      dealerId: user.dealerProfile.id,
      dealerName: user.dealerProfile.name,
      tier: user.dealerProfile.tier,
      membershipStatus: input.membershipStatus,
      proEntitled: input.proEntitled,
    };
  }
  return {
    kind: "member",
    userId: user.id,
    dealerId: user.dealerProfile.id,
    dealerName: user.dealerProfile.name,
  };
}

export function canApplyForTrade(actor: TradeActor): actor is Extract<TradeActor, { kind: "applicant" }> {
  if (actor.kind !== "applicant") return false;
  return actor.membershipStatus === "NOT_APPLIED" ||
    actor.membershipStatus === "NEEDS_INFO" ||
    actor.membershipStatus === "REJECTED" ||
    actor.membershipStatus === "REVOKED";
}

/** Dealers who already applied, or who can already trade, go to the status page instead of a 404. */
export function tradeApplyDestination(actor: TradeActor): "form" | "status" | "hidden" {
  if (actor.kind === "member" || (actor.kind === "applicant" && !canApplyForTrade(actor))) return "status";
  if (actor.kind === "applicant") return "form";
  return "hidden";
}

export function canViewTradeListing(input: {
  actor: TradeActor;
  listingDealerId: string;
  status: TradeListingStatus;
  sellerEligible: boolean;
  expiresAt?: Date | null;
  now?: Date;
}): boolean {
  if (input.actor.kind === "admin") return true;
  if (input.actor.kind !== "member") return false;
  if (input.actor.dealerId === input.listingDealerId) return true;
  const now = input.now ?? new Date();
  const unexpired = input.expiresAt instanceof Date && input.expiresAt.getTime() > now.getTime();
  return input.status === "LIVE" && input.sellerEligible && unexpired;
}

export function canEditTradeListing(actor: TradeActor, listingDealerId: string): boolean {
  return actor.kind === "admin" ||
    (actor.kind === "member" && actor.dealerId === listingDealerId);
}

export function canReadTradeEnquiry(input: {
  actor: TradeActor;
  fromDealerId: string;
  toDealerId: string;
}): boolean {
  if (input.actor.kind === "admin") return true;
  if (input.actor.kind !== "member") return false;
  return input.actor.dealerId === input.fromDealerId || input.actor.dealerId === input.toDealerId;
}
