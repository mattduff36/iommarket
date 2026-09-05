import type { Prisma } from "@prisma/client";
import { getMarketplaceDealerWhere, getPublicDealerWhere } from "@/lib/dealers/access";
import {
  DEFAULT_SAMPLE_VISIBILITY,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";

export interface DealerSpotlight {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  verified: boolean;
  _count: {
    listings: number;
  };
}

/**
 * Returns dealers that can safely be promoted on a public page.
 *
 * Verification is the existing admin approval signal used for homepage
 * promotion. The owner checks keep suspended, deleted, and demoted accounts
 * out even if their profile remains.
 */
export function getDealerSpotlightQuery(
  liveListingWhere: Prisma.ListingWhereInput,
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
) {
  return getDealerCardQuery(liveListingWhere, {
    ...getPublicDealerWhere(new Date(), sampleVisibility),
    verified: true,
  });
}

export function getDealerDirectoryQuery(
  liveListingWhere: Prisma.ListingWhereInput,
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
) {
  return getDealerCardQuery(
    liveListingWhere,
    getPublicDealerWhere(new Date(), sampleVisibility),
  );
}

export function getMarketplaceDealerDirectoryQuery(
  listingWhere: Prisma.ListingWhereInput,
  viewer?: { role: string } | null,
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
) {
  return getDealerCardQuery(
    listingWhere,
    getMarketplaceDealerWhere(viewer, new Date(), sampleVisibility),
  );
}

export function getMarketplaceDealerSpotlightQuery(
  listingWhere: Prisma.ListingWhereInput,
  viewer?: { role: string } | null,
  sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY,
) {
  const publicSpotlight: Prisma.DealerProfileWhereInput = {
    ...getPublicDealerWhere(new Date(), sampleVisibility),
    verified: true,
  };
  if (viewer?.role !== "ADMIN") {
    return getDealerCardQuery(listingWhere, publicSpotlight);
  }
  return getDealerCardQuery(listingWhere, {
    OR: [publicSpotlight, { isAdminPreview: true, previewPack: { enabled: true } }],
  });
}

function getDealerCardQuery(
  liveListingWhere: Prisma.ListingWhereInput,
  where: Prisma.DealerProfileWhereInput,
) {
  return {
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      bio: true,
      logoUrl: true,
      verified: true,
      _count: {
        select: {
          listings: { where: liveListingWhere },
        },
      },
    },
  } satisfies Prisma.DealerProfileFindManyArgs;
}

export function sortDealersAlphabetically<
  T extends { id: string; slug: string; name: string },
>(dealers: readonly T[]): T[] {
  const nameCollator = new Intl.Collator("en-GB", {
    sensitivity: "base",
    usage: "sort",
  });

  return [...dealers].sort((firstDealer, secondDealer) => {
    const nameComparison = nameCollator.compare(
      firstDealer.name,
      secondDealer.name,
    );
    if (nameComparison !== 0) return nameComparison;

    const slugComparison = firstDealer.slug.localeCompare(
      secondDealer.slug,
      "en-GB",
    );
    if (slugComparison !== 0) return slugComparison;

    return firstDealer.id.localeCompare(secondDealer.id, "en-GB");
  });
}

/**
 * Uses Fisher–Yates so every input item has an equal chance of every position.
 * The random source is injectable to keep behavior deterministic in tests.
 */
export function shuffleDealerSpotlights<T>(
  dealers: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffledDealers = [...dealers];

  for (let index = shuffledDealers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledDealers[index], shuffledDealers[swapIndex]] = [
      shuffledDealers[swapIndex],
      shuffledDealers[index],
    ];
  }

  return shuffledDealers;
}
