import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const staticRoutes = [
    "/",
    "/search",
    "/pricing",
    "/categories",
    "/terms",
    "/privacy",
    "/cookies",
    "/safety",
  ];

  const listings = await db.listing.findMany({
    where: { status: "LIVE" },
    select: { id: true, updatedAt: true },
    take: 2000,
    orderBy: { updatedAt: "desc" },
  });

  return [
    ...staticRoutes.map((route) => ({
      url: `${baseUrl}${route}`,
      lastModified: new Date(),
    })),
    ...listings.map((listing) => ({
      url: `${baseUrl}/listings/${listing.id}`,
      lastModified: listing.updatedAt,
    })),
  ];
}
