export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AdminListingChoiceModal } from "./admin-listing-choice-modal";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up?next=/sell");
  if (user.role === "DEALER") {
    redirect("/sell/dealer");
  }

  if (user.role === "USER") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">
          Start Selling
        </h1>
        <p className="text-text-secondary mb-6">
          Choose the listing path that fits you best.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <h2 className="text-lg font-semibold text-text-primary">Private Seller</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Perfect for occasional listings.
            </p>
            <Button asChild size="sm" className="mt-4">
              <Link href="/sell/private">Create Private Listing</Link>
            </Button>
          </div>
          <div className="rounded-lg border border-border p-4">
            <h2 className="text-lg font-semibold text-text-primary">Dealer Account</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Need more active listings and dealer tools? Upgrade to a dealer plan.
            </p>
            <div className="mt-4 flex gap-2">
              <Button asChild size="sm">
                <Link href="/dealer/subscribe?tier=STARTER">Choose Starter</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/pricing">Compare Plans</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (user.role === "ADMIN") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
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
