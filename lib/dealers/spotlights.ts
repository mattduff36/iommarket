import type { Prisma } from "@prisma/client";
import { getPublicDealerWhere } from "@/lib/dealers/access";

export interface DealerSpotlight {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  _count: {
    listings: number;
  };
}

/**
 * Returns dealers that can safely be promoted on a public page.
 *
 * Verification is the existing admin approval signal. The owner checks keep
 * suspended, deleted, and demoted accounts out even if their profile remains.
 */
export function getDealerSpotlightQuery(
  liveListingWhere: Prisma.ListingWhereInput,
) {
  return {
    where: getPublicDealerWhere(),
    select: {
      id: true,
      name: true,
      slug: true,
      bio: true,
      logoUrl: true,
      _count: {
        select: {
          listings: { where: liveListingWhere },
        },
      },
    },
  } satisfies Prisma.DealerProfileFindManyArgs;
}

export function getDealerDirectoryQuery(
  liveListingWhere: Prisma.ListingWhereInput,
) {
  return getDealerSpotlightQuery(liveListingWhere);
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
