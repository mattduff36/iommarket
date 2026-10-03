import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import { buildLaunchSitemap } from "@/lib/launch/public-metadata";
import { marketplaceListingWhereWithSettings } from "@/lib/listings/marketplace";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import {
  buildCategorySearchPath,
  buildDealerProfilePath,
  buildListingPath,
} from "@/lib/navigation-paths";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";
import {
  dedupeSitemapEntries,
  SITEMAP_PAGE_SIZE,
  sitemapPartitionIds,
  sliceSitemapPartition,
} from "@/lib/seo/sitemap-partitions";
import { isSearchIndexingEnabled } from "@/lib/seo/indexing-policy";

export const dynamic = "force-dynamic";

const STATIC_ROUTES = [
  "/",
  "/search",
  "/pricing",
  "/categories",
  "/dealers",
  "/vehicle-check",
  "/contact",
  "/sell-on-the-isle-of-man",
  "/dealer-advertising",
  "/terms",
  "/privacy",
  "/cookies",
  "/dealer-terms",
  "/private-seller-terms",
  "/acceptable-use",
  "/refunds",
  "/vehicle-check-terms",
  "/safety",
  "/faq",
];

async function findAllPages<T>(
  load: (skip: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await load(skip);
    rows.push(...page);
    if (page.length < SITEMAP_PAGE_SIZE) return rows;
    skip += page.length;
  }
}

async function loadLiveSitemap(): Promise<MetadataRoute.Sitemap> {
  const sampleVisibility = await getSampleVisibility();
  const listingWhere = await marketplaceListingWhereWithSettings({});
  const dealerWhere = getPublicDealerWhere(new Date(), sampleVisibility);
  const [listings, dealers, categories] = await Promise.all([
    findAllPages((skip) =>
      db.listing.findMany({
        where: listingWhere,
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
        skip,
        take: SITEMAP_PAGE_SIZE,
      }),
    ),
    findAllPages((skip) =>
      db.dealerProfile.findMany({
        where: dealerWhere,
        select: { slug: true, updatedAt: true },
        orderBy: { id: "asc" },
        skip,
        take: SITEMAP_PAGE_SIZE,
      }),
    ),
    db.category.findMany({
      where: { active: true },
      select: { slug: true, createdAt: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return dedupeSitemapEntries([
    ...STATIC_ROUTES.map((route) => ({
      url: buildCanonicalUrl(route),
    })),
    ...categories.map((category) => ({
      url: buildCanonicalUrl(buildCategorySearchPath(category.slug)),
      lastModified: category.createdAt,
    })),
    ...dealers.map((dealer) => ({
      url: buildCanonicalUrl(buildDealerProfilePath(dealer.slug)),
      lastModified: dealer.updatedAt,
    })),
    ...listings.map((listing) => ({
      url: buildCanonicalUrl(buildListingPath(listing.id)),
      lastModified: listing.updatedAt,
    })),
  ]);
}

export async function generateSitemaps() {
  if (!isSearchIndexingEnabled()) return [];
  const entries = await loadLiveSitemap();
  return sitemapPartitionIds(entries.length).map((id) => ({ id }));
}

export default async function sitemap(props?: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  return buildLaunchSitemap(process.env, async () => {
    const entries = await loadLiveSitemap();
    if (!props?.id) return entries;
    return sliceSitemapPartition(entries, await props.id);
  });
}
