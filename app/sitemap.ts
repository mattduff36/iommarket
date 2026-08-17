import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";
import {
  buildCategorySearchPath,
  buildDealerProfilePath,
  buildListingPath,
} from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await expireStaleLiveListings();
  const staticRoutes = [
    "/",
    "/search",
    "/pricing",
    "/categories",
    "/dealers",
    "/vehicle-check",
    "/contact",
    "/terms",
    "/privacy",
    "/cookies",
    "/dealer-terms",
    "/private-seller-terms",
    "/acceptable-use",
    "/refunds",
    "/vehicle-check-terms",
    "/safety",
  ];

  const [listings, dealers, categories] = await Promise.all([
    db.listing.findMany({
      where: liveListingWhere(),
      select: { id: true, updatedAt: true },
      take: 2000,
      orderBy: { updatedAt: "desc" },
    }),
    db.dealerProfile.findMany({
      where: getPublicDealerWhere(),
      select: { slug: true, updatedAt: true },
      take: 2000,
      orderBy: { updatedAt: "desc" },
    }),
    db.category.findMany({
      where: { active: true },
      select: { slug: true, createdAt: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return [
    ...staticRoutes.map((route) => ({
      url: buildCanonicalUrl(route),
      lastModified: new Date(),
    })),
    ...listings.map((listing) => ({
      url: buildCanonicalUrl(buildListingPath(listing.id)),
      lastModified: listing.updatedAt,
    })),
    ...dealers.map((dealer) => ({
      url: buildCanonicalUrl(buildDealerProfilePath(dealer.slug)),
      lastModified: dealer.updatedAt,
    })),
    ...categories.map((category) => ({
      url: buildCanonicalUrl(buildCategorySearchPath(category.slug)),
      lastModified: category.createdAt,
    })),
  ];
}
