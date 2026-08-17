import type {
  ListingLifecycleAction,
  ListingStatus,
  ListingStatusEventSource,
} from "@prisma/client";

export const LIFECYCLE_ACTIONS_REQUIRING_REASON: ReadonlySet<ListingLifecycleAction> =
  new Set([
    "REJECT",
    "TAKE_DOWN",
    "REINSTATE_LIVE",
    "RETURN_TO_DRAFT",
    "ACCOUNT_DISABLE",
    "ACCOUNT_DISABLE_PENDING",
    "REJECT_REVISION",
  ]);

export const LIFECYCLE_ACTION_TRANSITIONS: Record<
  ListingLifecycleAction,
  { from: ListingStatus[]; to: ListingStatus }
> = {
  SUBMIT: { from: ["DRAFT", "TAKEN_DOWN", "REJECTED"], to: "PENDING" },
  WITHDRAW: { from: ["PENDING"], to: "DRAFT" },
  APPROVE: { from: ["PENDING", "APPROVED"], to: "LIVE" },
  REJECT: { from: ["PENDING"], to: "REJECTED" },
  TAKE_DOWN: { from: ["LIVE", "APPROVED"], to: "TAKEN_DOWN" },
  EXPIRE: { from: ["LIVE"], to: "EXPIRED" },
  MARK_SOLD: { from: ["LIVE"], to: "SOLD" },
  RENEW: { from: ["EXPIRED", "TAKEN_DOWN"], to: "DRAFT" },
  REINSTATE_LIVE: { from: ["TAKEN_DOWN"], to: "LIVE" },
  RETURN_TO_DRAFT: { from: ["TAKEN_DOWN", "REJECTED"], to: "DRAFT" },
  ACCOUNT_DISABLE: { from: ["LIVE", "APPROVED"], to: "TAKEN_DOWN" },
  ACCOUNT_DISABLE_PENDING: { from: ["PENDING"], to: "REJECTED" },
  SYSTEM_BACKFILL: { from: [], to: "DRAFT" },
  SUBMIT_REVISION: { from: ["LIVE"], to: "LIVE" },
  APPROVE_REVISION: { from: ["LIVE"], to: "LIVE" },
  REJECT_REVISION: { from: ["LIVE"], to: "LIVE" },
};

export type LifecycleActorRole = "USER" | "DEALER" | "ADMIN" | "SYSTEM" | "PAYMENT";

export function isActionAuthorized(input: {
  action: ListingLifecycleAction;
  actorRole: LifecycleActorRole;
  source: ListingStatusEventSource;
  isOwner: boolean;
}) {
  switch (input.action) {
    case "SUBMIT":
    case "SUBMIT_REVISION":
      return (
        input.isOwner &&
        (input.source === "USER" || input.source === "PAYMENT")
      );
    case "WITHDRAW":
      return input.isOwner && input.source === "USER";
    case "APPROVE":
    case "REJECT":
    case "TAKE_DOWN":
    case "REINSTATE_LIVE":
    case "RETURN_TO_DRAFT":
    case "APPROVE_REVISION":
    case "REJECT_REVISION":
      return input.actorRole === "ADMIN" && input.source === "ADMIN";
    case "EXPIRE":
      return input.source === "SYSTEM";
    case "MARK_SOLD":
      return input.isOwner && input.source === "USER";
    case "RENEW":
      return input.isOwner && input.source === "USER";
    case "ACCOUNT_DISABLE":
    case "ACCOUNT_DISABLE_PENDING":
      return (
        (input.actorRole === "ADMIN" && input.source === "ADMIN") ||
        (input.isOwner && input.source === "USER")
      );
    case "SYSTEM_BACKFILL":
      return false;
    default:
      return false;
  }
}

export function canTransitionAction(
  action: ListingLifecycleAction,
  from: ListingStatus,
) {
  return LIFECYCLE_ACTION_TRANSITIONS[action]?.from.includes(from) ?? false;
}

export function getActionTargetStatus(action: ListingLifecycleAction) {
  return LIFECYCLE_ACTION_TRANSITIONS[action].to;
}

export function canReinstateLive(input: {
  status: ListingStatus;
  expiresAt: Date | null;
  now?: Date;
  hasPriorLive: boolean;
}) {
  const now = input.now ?? new Date();
  return (
    input.status === "TAKEN_DOWN" &&
    input.hasPriorLive &&
    input.expiresAt !== null &&
    input.expiresAt.getTime() > now.getTime()
  );
}
