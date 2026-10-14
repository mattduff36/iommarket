import type { TradeEnquiryStatus, TradeListingStatus } from "@prisma/client";

export type TradeLifecycleActor = "owner" | "admin" | "system";

const OWNER_TRANSITIONS: Record<TradeListingStatus, TradeListingStatus[]> = {
  DRAFT: ["LIVE", "REMOVED"],
  PENDING_REVIEW: [],
  LIVE: ["RESERVED", "SOLD", "WITHDRAWN"],
  RESERVED: ["LIVE", "SOLD", "WITHDRAWN"],
  SOLD: [],
  WITHDRAWN: [],
  EXPIRED: ["LIVE"],
  REMOVED: [],
};

const ADMIN_TRANSITIONS: Record<TradeListingStatus, TradeListingStatus[]> = {
  DRAFT: ["REMOVED"],
  PENDING_REVIEW: ["LIVE", "REMOVED"],
  LIVE: ["PENDING_REVIEW", "REMOVED"],
  RESERVED: ["PENDING_REVIEW", "REMOVED"],
  SOLD: ["REMOVED"],
  WITHDRAWN: ["REMOVED"],
  EXPIRED: ["REMOVED"],
  REMOVED: [],
};

export function canTransitionTradeListing(
  from: TradeListingStatus,
  to: TradeListingStatus,
  actor: TradeLifecycleActor,
): boolean {
  if (from === to) return false;
  if (actor === "system") return (from === "LIVE" || from === "RESERVED") && to === "EXPIRED";
  const allowed = actor === "admin" ? ADMIN_TRANSITIONS[from] : OWNER_TRANSITIONS[from];
  return allowed.includes(to);
}

const ENQUIRY_OWNER: Record<TradeEnquiryStatus, TradeEnquiryStatus[]> = {
  OPEN: ["WITHDRAWN"],
  WITHDRAWN: [],
  DECLINED: [],
  ACCEPTED_IN_PRINCIPLE: ["CLOSED"],
  CLOSED: [],
};

const ENQUIRY_LISTING_OWNER: Record<TradeEnquiryStatus, TradeEnquiryStatus[]> = {
  OPEN: ["DECLINED", "ACCEPTED_IN_PRINCIPLE", "CLOSED"],
  WITHDRAWN: [],
  DECLINED: ["CLOSED"],
  ACCEPTED_IN_PRINCIPLE: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionTradeEnquiry(
  from: TradeEnquiryStatus,
  to: TradeEnquiryStatus,
  actor: "enquirer" | "listing-owner" | "admin",
): boolean {
  if (from === to) return false;
  if (actor === "admin") return to === "CLOSED";
  const allowed = actor === "enquirer" ? ENQUIRY_OWNER[from] : ENQUIRY_LISTING_OWNER[from];
  return allowed.includes(to);
}
