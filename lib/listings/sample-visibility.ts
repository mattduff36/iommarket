import { getDatabaseSyncVisibility, type DatabaseSyncVisibility } from "@/lib/database-sync/visibility";
import type { Prisma } from "@prisma/client";
import { getBoolSetting, SETTING_KEYS } from "@/lib/config/site-settings";

export const PLACEHOLDER_AUTH_PREFIX = "00000000-0000-0000-0000-";

export interface SampleVisibility extends Partial<DatabaseSyncVisibility> {
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

export function samplePrivateUserWhere(): Prisma.UserWhereInput {
  return {
    ...placeholderAuthUserWhere(),
    dealerProfile: null,
  };
}

export function sampleDealerUserWhere(): Prisma.UserWhereInput {
  return {
    ...placeholderAuthUserWhere(),
    dealerProfile: { isAdminPreview: false },
  };
}

export function sampleListingNotFilters(
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.ListingWhereInput[] {
  const filters: Prisma.ListingWhereInput[] = [];
  if (sample.archivedListingIds?.length) filters.push({ id: { in: sample.archivedListingIds } });
  if (sample.archivedDealerIds?.length) filters.push({ dealerId: { in: sample.archivedDealerIds } });
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
  const hidden: Prisma.DealerProfileWhereInput[] = [];
  if (!sample.dealerListings) hidden.push(sampleDealerProfileWhere());
  if (sample.archivedDealerIds?.length) hidden.push({ id: { in: sample.archivedDealerIds } });
  if (!hidden.length) return where;
  return { AND: [where, ...hidden.map((filter) => ({ NOT: filter }))] };
}

export function applySampleUserVisibility(
  where: Prisma.UserWhereInput,
  sample: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
): Prisma.UserWhereInput {
  const hidden: Prisma.UserWhereInput[] = [];
  if (!sample.privateListings) hidden.push(samplePrivateUserWhere());
  if (!sample.dealerListings) hidden.push(sampleDealerUserWhere());
  if (hidden.length === 0) return where;
  return {
    AND: [where, ...hidden.map((filter) => ({ NOT: filter }))],
  };
}

export function isHiddenSampleListing(input: {
  listingId?: string;
  authUserId: string;
  dealerId: string | null;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
}) {
  if (input.listingId && input.sampleVisibility.archivedListingIds?.includes(input.listingId)) return true;
  if (input.dealerId && input.sampleVisibility.archivedDealerIds?.includes(input.dealerId)) return true;
  if (!isPlaceholderAuthUserId(input.authUserId)) return false;
  if (!input.dealerId) return !input.sampleVisibility.privateListings;
  if (input.isAdminPreview) return false;
  return !input.sampleVisibility.dealerListings;
}

export function isHiddenSampleDealer(input: {
  dealerId?: string;
  authUserId: string;
  isAdminPreview: boolean;
  sampleVisibility: SampleVisibility;
}) {
  if (input.dealerId && input.sampleVisibility.archivedDealerIds?.includes(input.dealerId)) return true;
  if (input.isAdminPreview) return false;
  if (!isPlaceholderAuthUserId(input.authUserId)) return false;
  return !input.sampleVisibility.dealerListings;
}

export function isHiddenSampleUser(input: {
  authUserId: string;
  hasDealerProfile: boolean;
  sampleVisibility: SampleVisibility;
}) {
  if (!isPlaceholderAuthUserId(input.authUserId)) return false;
  return input.hasDealerProfile
    ? !input.sampleVisibility.dealerListings
    : !input.sampleVisibility.privateListings;
}

export async function getSampleVisibility(): Promise<SampleVisibility> {
  const [privateListings, dealerListings, syncVisibility] = await Promise.all([
    getBoolSetting(SETTING_KEYS.SAMPLE_PRIVATE_LISTINGS_VISIBLE, true),
    getBoolSetting(SETTING_KEYS.SAMPLE_DEALER_LISTINGS_VISIBLE, true),
    getDatabaseSyncVisibility(),
  ]);
  return { privateListings, dealerListings, ...syncVisibility };
}
