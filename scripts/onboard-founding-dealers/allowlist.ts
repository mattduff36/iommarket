export {
  assertFoundingDealerKeyAllowed,
  assertFoundingEmailAllowed,
  FOUNDING_DEALERS,
  FOUNDING_EMAIL_DOMAIN,
  foundingDealerKeys,
  foundingEmails,
  foundingEmailsForKeys,
  getFoundingDealer,
  isFoundingEmail,
  isProtectedOceanOwnerEmail,
} from "../../lib/dealers/onboarding/founding-allowlist";
export type {
  FoundingDealer,
  FoundingDealerKey,
} from "../../lib/dealers/onboarding/founding-allowlist";

export const FOUNDING_GRANT_DAYS = 90;
export const FOUNDING_PRO_CAP = 100;
export const FOUNDING_ADMIN_EMAIL = "admin@mpdee.co.uk";
export const FOUNDING_AUTH_METADATA_FLAG = "foundingOnboarding";
