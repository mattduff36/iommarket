import { OCEAN_DEALER_KEY, OCEAN_OWNER_EMAIL } from "../../lib/preview-packs/safety";

export const FOUNDING_EMAIL_DOMAIN = "itrader.im.preview";
export const FOUNDING_GRANT_DAYS = 90;
export const FOUNDING_PRO_CAP = 100;
export const FOUNDING_ADMIN_EMAIL = "admin@mpdee.co.uk";
export const FOUNDING_AUTH_METADATA_FLAG = "foundingOnboarding";

export const FOUNDING_DEALERS = [
  {
    key: "athol-garage",
    displayName: "Athol Garage",
    email: "atholgarage@itrader.im.preview",
    website: "https://www.athol.im/",
    regionSlug: "iom-south",
  },
  {
    key: "mikes-motors",
    displayName: "Mike's Motors",
    email: "mikesmotors@itrader.im.preview",
    website: "https://www.mikesmotors.im/",
    regionSlug: "iom-east",
  },
  {
    key: "rex-motor-company",
    displayName: "Rex Motor Company",
    email: "rexmotorcompany@itrader.im.preview",
    website: "https://www.rexmotorcompany.im/",
    regionSlug: "iom-east",
  },
  {
    key: "td-car-centre",
    displayName: "TD Car Centre",
    email: "tdcarcentre@itrader.im.preview",
    website: "https://www.tdcar.im/",
    regionSlug: "iom-east",
  },
] as const;

export type FoundingDealerKey = (typeof FOUNDING_DEALERS)[number]["key"];
export type FoundingDealer = (typeof FOUNDING_DEALERS)[number];

export function foundingDealerKeys() {
  return FOUNDING_DEALERS.map((dealer) => dealer.key);
}

export function getFoundingDealer(key: string) {
  const dealer = FOUNDING_DEALERS.find((item) => item.key === key);
  if (!dealer) throw new Error(`Refusing founding onboard: ${key} is not allowlisted.`);
  return dealer;
}

export function foundingEmails() {
  return FOUNDING_DEALERS.map((dealer) => dealer.email);
}

export function isFoundingEmail(email: string) {
  const value = email.trim().toLowerCase();
  return foundingEmails().some((item) => item === value);
}

export function isProtectedGmailOwner(email: string) {
  return /^mattduff36(\+.*)?@gmail\.com$/i.test(email.trim());
}

export function assertFoundingEmailAllowed(email: string) {
  const value = email.trim().toLowerCase();
  if (isProtectedGmailOwner(value) || value === OCEAN_OWNER_EMAIL) {
    throw new Error("Refusing founding onboard: Ocean owner Gmail is not allowed.");
  }
  if (value.endsWith("@preview.internal")) {
    throw new Error("Refusing founding onboard: preview-system emails are not allowed.");
  }
  if (!value.endsWith(`@${FOUNDING_EMAIL_DOMAIN}`) || !isFoundingEmail(value)) {
    throw new Error("Refusing founding onboard: email is not on the founding allowlist.");
  }
}

export function assertFoundingDealerKeyAllowed(key: string) {
  if (key === OCEAN_DEALER_KEY || key.startsWith("ocean-")) {
    throw new Error("Refusing founding onboard: Ocean dealers are not allowed.");
  }
  getFoundingDealer(key);
}
