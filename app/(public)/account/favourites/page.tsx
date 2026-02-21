export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ListingCard } from "@/components/marketplace/listing-card";

export default async function FavouritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const favourites = await db.favourite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        include: {
          images: { take: 1, orderBy: { order: "asc" } },
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
          {favourites.map(({ id, listing }) => (
            <ListingCard
              key={id}
              title={listing.title}
              price={listing.price / 100}
              imageSrc={listing.images[0]?.url}
              location={listing.region.name}
              meta={listing.category.name}
              featured={listing.featured}
              badge={listing.featured ? "Featured" : undefined}
              href={`/listings/${listing.id}`}
            />
          ))}
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
