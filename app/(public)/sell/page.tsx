export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { getSellLandingPath } from "@/lib/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AdminListingChoiceModal } from "./admin-listing-choice-modal";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await requireAcceptedUser("/sell");
  const sellLandingPath = getSellLandingPath(user.role);
  if (sellLandingPath) redirect(sellLandingPath);

  if (user.role === "ADMIN") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumbs
          items={[{ label: "Sell", href: "/sell" }]}
          structuredData={false}
        />
        <h1 className="text-3xl font-bold text-text-primary mb-2">
          Create a Listing
        </h1>
        <p className="text-text-secondary mb-6">
          Choose which flow you want to use for this listing.
        </p>
        <AdminListingChoiceModal />
      </div>
    );
  }
}
