import { db } from "@/lib/db";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import {
  buildCategorySearchPath,
  buildDealerProfilePath,
  buildListingPath,
} from "@/lib/navigation-paths";
import type { BreadcrumbEntry } from "@/lib/seo/structured-data";

export interface PublicListingDealer {
  name: string;
  slug: string;
  verified: boolean;
}

export async function getPublicListingDealer(
  dealerId: string | null,
  now = new Date(),
): Promise<PublicListingDealer | null> {
  if (!dealerId) return null;

  return db.dealerProfile.findFirst({
    where: {
      id: dealerId,
      ...getPublicDealerWhere(now),
    },
    select: {
      name: true,
      slug: true,
      verified: true,
    },
  });
}

interface ListingBreadcrumbInput {
  listingId: string;
  listingTitle: string;
  category: { name: string; slug: string };
  publicDealer: PublicListingDealer | null;
}

export function buildListingBreadcrumbItems({
  listingId,
  listingTitle,
  category,
  publicDealer,
}: ListingBreadcrumbInput): BreadcrumbEntry[] {
  const listing = {
    label: listingTitle,
    href: buildListingPath(listingId),
  };

  if (publicDealer) {
    return [
      { label: "Dealers", href: "/dealers" },
      {
        label: publicDealer.name,
        href: buildDealerProfilePath(publicDealer.slug),
      },
      listing,
    ];
  }

  return [
    { label: "Buy", href: "/categories" },
    {
      label: category.name,
      href: buildCategorySearchPath(category.slug),
    },
    listing,
  ];
}
