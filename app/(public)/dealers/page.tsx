export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DealerDirectory } from "@/components/dealers/dealer-directory";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { db } from "@/lib/db";
import {
  getDealerDirectoryQuery,
  sortDealersAlphabetically,
} from "@/lib/dealers/spotlights";
import {
  expireStaleLiveListings,
  liveListingWhere,
} from "@/lib/listings/expiry";

export const metadata: Metadata = {
  title: "Isle of Man Dealers",
  description:
    "Browse active Isle of Man vehicle dealers and visit their profiles on itrader.im.",
};

export default async function DealersPage() {
  await expireStaleLiveListings();
  const dealers = await db.dealerProfile.findMany(
    getDealerDirectoryQuery(liveListingWhere()),
  );
  const sortedDealers = sortDealersAlphabetically(dealers);

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <Breadcrumbs items={[{ label: "Dealers" }]} />

      <header className="mb-8 max-w-3xl sm:mb-10">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-neon-blue-400">
          Local experts
        </p>
        <h1 className="section-heading-accent mt-3 text-3xl font-bold text-text-primary font-heading sm:text-4xl">
          Isle of Man Dealers
        </h1>
        <p className="mt-4 text-base leading-7 text-text-secondary">
          Explore active local dealers, their latest stock, and public profiles.
          Admin-verified businesses are clearly marked. Dealers are listed
          alphabetically.
        </p>
        <p className="mt-3 text-sm text-metallic-400">
          {sortedDealers.length}{" "}
          {sortedDealers.length === 1 ? "dealer" : "dealers"}
        </p>
      </header>

      <DealerDirectory dealers={sortedDealers} />
    </main>
  );
}
