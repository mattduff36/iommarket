import type { DealerOnboardingInviteStatus } from "@prisma/client";

export const LIVE_ONBOARDING_STATUSES = [
  "SEND_FAILED",
  "SENT",
  "CLAIMING",
  "FINALIZING_AUTH",
] as const satisfies readonly DealerOnboardingInviteStatus[];

export const BLOCKING_ONBOARDING_STATUSES = LIVE_ONBOARDING_STATUSES;

export function displayOnboardingStatus(
  status: DealerOnboardingInviteStatus,
  expiresAt: Date,
  now: Date,
): DealerOnboardingInviteStatus {
  if (
    (status === "SENT" || status === "CLAIMING" || status === "SEND_FAILED") &&
    expiresAt.getTime() <= now.getTime()
  ) {
    return "EXPIRED";
  }
  return status;
}

export function canResendOnboardingInvite(
  status: DealerOnboardingInviteStatus,
  expiresAt: Date,
  now: Date,
) {
  const displayed = displayOnboardingStatus(status, expiresAt, now);
  return displayed === "SEND_FAILED" || displayed === "SENT" || displayed === "EXPIRED" || displayed === "CLAIMING";
}

export function canRevokeOnboardingInvite(status: DealerOnboardingInviteStatus) {
  return status === "SEND_FAILED" || status === "SENT" || status === "CLAIMING" || status === "EXPIRED";
}
