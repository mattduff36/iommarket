export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { DemoCarouselShowcase } from "@/components/marketplace/home/demo-carousel-showcase";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";

export const metadata: Metadata = {
  title: "Demo Carousel",
  description:
    "Client demo page comparing multiple center-focused vehicle carousel styles using live listing data.",
};

export default async function DemoCarouselPage() {
  await expireStaleLiveListings();
  const liveWhere = liveListingWhere();

  const listings = await db.listing.findMany({
    where: liveWhere,
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: 10,
    include: {
      images: { take: 1, orderBy: { order: "asc" } },
      category: true,
      region: true,
    },
  });

  const carouselItems = listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    price: Math.round(listing.price / 100),
    imageSrc: listing.images[0]?.url,
    location: listing.region.name,
    meta: listing.category.name,
    href: `/listings/${listing.id}`,
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mb-8 rounded-xl border border-border bg-surface/70 p-5 sm:mb-10 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neon-blue-400">
          Client Preview
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-primary sm:text-3xl">
          Demo Carousel Showcase
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-secondary sm:text-base">
          Five center-first carousel concepts using live vehicle data from the current marketplace.
          Each concept keeps the central card visually dominant while still previewing neighboring
          slides. This page is intended for design selection and can be removed after client sign-off.
        </p>
      </div>

      <DemoCarouselShowcase items={carouselItems} />
    </div>
  );
}
