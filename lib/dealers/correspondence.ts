export const DEALER_EMAIL_CATEGORIES = [
  "BUYER_ENQUIRIES",
  "LISTING_UPDATES",
  "REVIEWS",
  "SUBSCRIPTION",
  "DEALER_ACCOUNT",
] as const;

export type DealerCorrespondenceCategory = (typeof DEALER_EMAIL_CATEGORIES)[number];

export const CORRESPONDENCE_SECURITY_NOTE =
  "Sign-in, password, and security emails always go to your login address.";

export const DEALER_EMAIL_CATEGORY_OPTIONS: ReadonlyArray<{
  value: DealerCorrespondenceCategory;
  label: string;
  description: string;
}> = [
  {
    value: "BUYER_ENQUIRIES",
    label: "Buyer enquiries",
    description: "Messages from people asking about your listings.",
  },
  {
    value: "LISTING_UPDATES",
    label: "Listing updates",
    description: "Submission, approval, expiry, and other listing status emails.",
  },
  {
    value: "REVIEWS",
    label: "Reviews",
    description: "Decisions on your review responses and disputes.",
  },
  {
    value: "SUBSCRIPTION",
    label: "Subscription and cancellation",
    description: "Updates about your dealer subscription.",
  },
  {
    value: "DEALER_ACCOUNT",
    label: "Dealer account notices",
    description: "Profile verification and similar account notices.",
  },
];

export interface CorrespondenceRoutingSettings {
  verifiedEmail: string | null;
  categories: readonly DealerCorrespondenceCategory[];
  copyAssignedToPrimary: boolean;
}

export function normalizeCorrespondenceEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function canonicalCorrespondenceCategories(
  categories: readonly DealerCorrespondenceCategory[],
): DealerCorrespondenceCategory[] {
  return DEALER_EMAIL_CATEGORIES.filter((category) => categories.includes(category));
}

export function resolveCorrespondenceRecipients(input: {
  primaryEmail: string;
  category: DealerCorrespondenceCategory;
  settings: CorrespondenceRoutingSettings | null;
}): string[] {
  const primary = normalizeCorrespondenceEmail(input.primaryEmail);
  if (!primary) return [];

  const verified = input.settings?.verifiedEmail
    ? normalizeCorrespondenceEmail(input.settings.verifiedEmail)
    : "";
  const selected = input.settings?.categories.includes(input.category) ?? false;
  if (!verified || !selected || verified === primary) return [primary];
  if (input.settings?.copyAssignedToPrimary) return [verified, primary];
  return [verified];
}

export function correspondenceRoutingNote(input: {
  primaryEmail: string;
  verifiedEmail: string | null;
  pendingEmail: string | null;
  verificationExpiresAt: string | null;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const pending = input.pendingEmail;
  const verified = input.verifiedEmail;
  const expiresAt = input.verificationExpiresAt
    ? new Date(input.verificationExpiresAt)
    : null;
  const pendingExpired = Boolean(
    pending && expiresAt && expiresAt.getTime() <= now.getTime(),
  );
  const activeDestination = verified ?? input.primaryEmail;

  if (pending && pendingExpired) {
    return `The confirmation link for ${pending} has expired. Send a new link before that address can receive email. Until then, correspondence still uses ${activeDestination}.`;
  }
  if (pending && verified) {
    return `${pending} is waiting for confirmation. Until you confirm it, selected emails continue to go to ${verified}.`;
  }
  if (pending) {
    return `${pending} is waiting for confirmation. Until you confirm it, every email still goes to ${input.primaryEmail}.`;
  }
  if (verified) {
    return `Confirmed. Emails you assign below go to ${verified}, unless you also copy them to ${input.primaryEmail}.`;
  }
  return `Add a second email address. Every email goes to ${input.primaryEmail} until that address is confirmed.`;
}
