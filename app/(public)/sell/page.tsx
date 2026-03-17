export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminListingChoiceModal } from "./admin-listing-choice-modal";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/sell");
  if (user.role === "DEALER") {
    redirect("/sell/dealer");
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

  redirect("/sell/private");
}
