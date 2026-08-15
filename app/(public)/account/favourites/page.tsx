export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { isListingPubliclyVisible } from "@/lib/listings/visibility";

export default async function FavouritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up");

  const favourites = await db.favourite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        include: {
          images: { take: 1, orderBy: { order: "asc" }, select: listingPhotoSelect },
          category: true,
          region: true,
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Saved Listings
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        {favourites.length} favourite{favourites.length === 1 ? "" : "s"}
      </p>

      {favourites.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
          {favourites.map(({ id, listing }) => {
            const available = isListingPubliclyVisible({
              status: listing.status,
              expiresAt: listing.expiresAt,
            });
            return (
              <ListingCard
                key={id}
                title={listing.title}
                price={listing.price / 100}
                photo={toListingPhotoSource(listing.images[0])}
                location={listing.region.name}
                meta={listing.category.name}
                featured={listing.featured}
                badge={available ? (listing.featured ? "Featured" : undefined) : "Unavailable"}
                href={available ? `/listings/${listing.id}` : undefined}
              />
            );
          })}
        </div>
      ) : (
        <p className="mt-8 text-sm text-text-secondary">
          You have not saved any listings yet.{" "}
          <Link href="/search" className="text-text-trust hover:underline">
            Browse listings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
