export const OCEAN_OWNER_EMAIL = "mattduff36@gmail.com";
export const OCEAN_DEALER_NAME = "Ocean Motor Village";
export const OCEAN_DEALER_KEY = "ocean-motor-village";
export const PREVIEW_EMAIL_DOMAIN = "preview.internal";

export function previewSystemEmail(dealerKey: string) {
  return `preview+${dealerKey}@${PREVIEW_EMAIL_DOMAIN}`;
}

export function previewSystemAuthUserId(dealerKey: string) {
  return `preview-system:${dealerKey}`;
}

export function previewDealerSlug(dealerKey: string) {
  return `preview-${dealerKey}`;
}

export function isExcludedPreviewDealerKey(dealerKey: string, groupKey?: string | null) {
  const key = dealerKey.trim().toLowerCase();
  if (key === OCEAN_DEALER_KEY || key.startsWith("ocean-")) return true;
  return groupKey?.trim().toLowerCase() === "ocean";
}

export function isProtectedPreviewOwnerEmail(email: string) {
  return email.trim().toLowerCase() === OCEAN_OWNER_EMAIL;
}

export function assertNotOceanDealerProfile(input: {
  dealerId: string;
  oceanDealerId?: string | null;
}) {
  if (input.oceanDealerId && input.dealerId === input.oceanDealerId) {
    throw new Error("Refuse to attach preview listings to the Ocean dealer profile.");
  }
}

export function assertPreviewDealerAllowed(input: {
  dealerKey: string;
  displayName?: string;
  groupKey?: string | null;
  ownerEmail?: string | null;
}) {
  if (isExcludedPreviewDealerKey(input.dealerKey, input.groupKey)) {
    throw new Error("Ocean Motor Village is excluded from preview packs.");
  }
  if (input.displayName?.trim().toLowerCase() === OCEAN_DEALER_NAME.toLowerCase()) {
    throw new Error("Ocean Motor Village is excluded from preview packs.");
  }
  if (input.ownerEmail && isProtectedPreviewOwnerEmail(input.ownerEmail)) {
    throw new Error("Refuse to attach preview listings to the Ocean owner account.");
  }
}
