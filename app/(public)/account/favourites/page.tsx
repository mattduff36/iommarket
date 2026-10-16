export const dynamic = "force-dynamic";

import Link from "@/components/navigation/link";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";
import { listingPhotoSelect, toListingPhotoSource } from "@/lib/images/photo";
import { applySampleListingVisibility, getSampleVisibility } from "@/lib/listings/sample-visibility";
import { isListingPubliclyVisible } from "@/lib/listings/visibility";
import { getPublicDealerWhere } from "@/lib/dealers/access";
import { publicListingSellerWhere } from "@/lib/listings/dealer-visibility";

export default async function FavouritesPage() {
  const user = await requireAcceptedUser("/account/favourites");
  const sampleVisibility = await getSampleVisibility();

  const favourites = await db.favourite.findMany({
    where: {
      userId: user.id,
      listing: {
        AND: [
          applySampleListingVisibility({}, sampleVisibility),
          publicListingSellerWhere(undefined, sampleVisibility),
        ],
      },
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
    where: {
      AND: [
        { id: { in: dealerIds } },
        getPublicDealerWhere(undefined, sampleVisibility),
      ],
    },
    select: { id: true },
  })).map((dealer) => dealer.id) : []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="section-heading-accent font-heading text-2xl font-bold text-text-primary sm:text-3xl">
          Saved Listings
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {favourites.length} favourite{favourites.length === 1 ? "" : "s"}
        </p>
      </div>

      {favourites.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 sm:gap-6">
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
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-text-secondary">You have not saved any listings yet.</p>
          <Link href="/search" className="mt-3 inline-flex text-sm text-text-trust hover:underline">
            Browse listings
          </Link>
        </div>
      )}
    </div>
  );
}
