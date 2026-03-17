export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { CreateListingForm } from "../create-listing-form";
import { getSellFormData } from "../sell-form-data";

export const metadata: Metadata = {
  title: "Dealer Listing",
  description: "Create a dealer listing on itrader.im.",
};

export default async function SellDealerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/sell/dealer");
  if (user.role === "USER") redirect("/sell/private");
  if (!user.dealerProfile) redirect("/pricing");

  const activeSubscription = await db.subscription.findFirst({
    where: {
      dealerId: user.dealerProfile.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (!activeSubscription) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-4">
        <h1 className="text-3xl font-bold text-text-primary">Dealer Listing</h1>
        <p className="text-text-secondary">
          An active dealer subscription is required before you can create new dealer listings.
        </p>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/pricing">View Dealer Plans</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dealer/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { categories, regions } = await getSellFormData();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-text-primary mb-2">
        Create a Dealer Listing
      </h1>
      <p className="text-text-secondary mb-8">
        Publish inventory from your dealer account. Your listing is submitted for moderation after this step.
      </p>

      <CreateListingForm categories={categories} regions={regions} mode="dealer" />
    </div>
  );
}
