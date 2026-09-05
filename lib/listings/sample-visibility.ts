import type { Prisma } from "@prisma/client";
import { getBoolSetting, SETTING_KEYS } from "@/lib/config/site-settings";

export const PLACEHOLDER_AUTH_PREFIX = "00000000-0000-0000-0000-";

export interface SampleVisibility {
  privateListings: boolean;
  dealerListings: boolean;
}

export const DEFAULT_SAMPLE_VISIBILITY: SampleVisibility = {
  privateListings: true,
  dealerListings: true,
};

export function isPlaceholderAuthUserId(authUserId: string) {
  return authUserId.startsWith(PLACEHOLDER_AUTH_PREFIX);
}

export function placeholderAuthUserWhere(): Prisma.UserWhereInput {
  return { authUserId: { startsWith: PLACEHOLDER_AUTH_PREFIX } };
}

export function samplePrivateListingWhere(): Prisma.ListingWhereInput {
  return {
    dealerId: null,
    user: placeholderAuthUserWhere(),
  };
}

export function sampleDealerListingWhere(): Prisma.ListingWhereInput {
  return {
    dealerId: { not: null },
    dealer: { isAdminPreview: false },
    user: placeholderAuthUserWhere(),
  };
}

export function sampleDealerProfileWhere(): Prisma.DealerProfileWhereInput {
  return {
    isAdminPreview: false,
    user: placeholderAuthUserWhere(),
  };
}

export function sampleListingNotFilters(
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingWhereInput[] {
  const filters: Prisma.ListingWhereInput[] = [];
  if (!sample.privateListings) filters.push(samplePrivateListingWhere());
  if (!sample.dealerListings) filters.push(sampleDealerListingWhere());
  return filters;
}

export function applySampleListingVisibility(
  where: Prisma.ListingWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingWhereInput {
  const hidden = sampleListingNotFilters(sample);
  if (hidden.length === 0) return where;
  return {
    AND: [where, ...hidden.map((filter) => ({ NOT: filter }))],
  };
}

export function applySampleDealerVisibility(
  where: Prisma.DealerProfileWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.DealerProfileWhereInput {
  if (sample.dealerListings) return where;
  return {
    AND: [where, { NOT: sampleDealerProfileWhere() }],
  };
}

export function isHiddenSampleListing(input: {
  authUserId: string;
  dealerId: string | null;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
}) {
  if (!isPlaceholderAuthUserId(input.authUserId)) return false;
  if (!input.dealerId) return !input.sampleVisibility.privateListings;
  if (input.isAdminPreview) return false;
  return !input.sampleVisibility.dealerListings;
}

export function isHiddenSampleDealer(input: {
  authUserId: string;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
}) {
  if (input.isAdminPreview) return false;
  if (!isPlaceholderAuthUserId(input.authUserId)) return false;
  return !input.sampleVisibility.dealerListings;
}

export async function getSampleVisibility(): Promise<SampleVisibility> {
  const [privateListings, dealerListings] = await Promise.all([
    getBoolSetting(SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE, true),
    getBoolSetting(SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE, true),
  ]);
  return { privateListings, dealerListings };
}
