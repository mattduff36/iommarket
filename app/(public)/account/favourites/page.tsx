export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { applySampleListingVisibility, getSampleVisibility } from "@/lib/listings/sample-visibility";
import { isListingPubliclyVisible } from "@/lib/listings/visibility";
import { getPublicDealerWhere } from "@/lib/dealers/access";

export default async function FavouritesPage() {
  const user = await requireAcceptedUser("/account/favourites");

  const favourites = await db.favourite.findMany({
    where: {
      userId: user.id,
      listing: applySampleListingVisibility({}, await getSampleVisibility()),
    },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        include: {
          images: { take: 1, orderBy: { order: "asc" }, select: listingPhotoSelect },
          category: true,
          region: true,
          attributeValues: {
            where: { attributeDefinition: { slug: "write-off-category" } },
            select: {
              value: true,
              attributeDefinition: { select: { slug: true } },
            },
          },
        },
      },
    },
  });

  const dealerIds = [...new Set(favourites.flatMap(({ listing }) => listing.dealerId ? [listing.dealerId] : []))];
  const visibleDealers = new Set(dealerIds.length ? (await db.dealerProfile.findMany({
    where: { AND: [{ id: { in: dealerIds } }, getPublicDealerWhere()] },
    select: { id: true },
  })).map((dealer) => dealer.id) : []);

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
              dealerAccess: !listing.dealerId || visibleDealers.has(listing.dealerId),
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
                writeOffCategory={listing.attributeValues[0]?.value ?? null}
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
