export const DEALER_PROFILE_ADDRESS_CHANGE_LIMIT = 2;
export const DEALER_PROFILE_ADDRESS_CHANGE_WINDOW_DAYS = 365;
export const DEALER_PROFILE_ADDRESS_CHANGE_LIMIT_MESSAGE =
  "Dealer profile addresses can be changed twice in any 365-day period.";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DealerProfileAddressChangeSource = "SELF_SERVICE" | "SYSTEM";

export function getDealerProfileAddressChangeWindowStart(now: Date): Date {
  return new Date(
    now.getTime() - DEALER_PROFILE_ADDRESS_CHANGE_WINDOW_DAYS * DAY_MS,
  );
}

export function getDealerProfileAddressChangeError(input: {
  currentSlug: string;
  nextSlug: string;
  changesInWindow: number;
}): string | null {
  if (input.currentSlug === input.nextSlug) return null;
  if (input.changesInWindow < DEALER_PROFILE_ADDRESS_CHANGE_LIMIT) return null;
  return DEALER_PROFILE_ADDRESS_CHANGE_LIMIT_MESSAGE;
}

export function shouldCountDealerProfileAddressChange(input: {
  source: DealerProfileAddressChangeSource;
  previousSlug: string;
  userId: string;
}): boolean {
  return (
    input.source === "SELF_SERVICE" &&
    input.previousSlug !== `dealer-${input.userId}`
  );
}
