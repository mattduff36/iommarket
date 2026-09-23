import { OCEAN_DEALER_KEY, OCEAN_OWNER_EMAIL } from "@/lib/preview-packs/safety";

export const FOUNDING_EMAIL_DOMAIN = "itrader.im.preview";

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

export function foundingEmailsForKeys(keys: readonly string[]) {
  const selected = new Set(keys);
  return FOUNDING_DEALERS.filter((dealer) => selected.has(dealer.key)).map((dealer) => dealer.email);
}

export function isFoundingEmail(email: string) {
  const value = email.trim().toLowerCase();
  return foundingEmails().some((item) => item === value);
}

export function isProtectedOceanOwnerEmail(email: string) {
  return email.trim().toLowerCase() === OCEAN_OWNER_EMAIL;
}

export function assertFoundingEmailAllowed(email: string) {
  const value = email.trim().toLowerCase();
  if (isProtectedOceanOwnerEmail(value)) {
    throw new Error("Refusing founding onboard: Ocean owner email is not allowed.");
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
