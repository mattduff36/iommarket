export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { isPrivateListingFreeForUser } from "@/lib/config/marketplace";
import { getEditableDraft } from "@/lib/listings/editable-draft";
import { CreateListingForm } from "../create-listing-form";
import { FreeListingWelcomeDialog } from "../free-listing-welcome-dialog";
import { getSellFormData } from "../sell-form-data";

export const metadata: Metadata = {
  title: "Private Listing",
  description: "Create a private seller listing on itrader.im.",
};

interface Props {
  searchParams?: Promise<{
    draft?: string;
  }>;
}

export default async function SellPrivatePage({ searchParams }: Props) {
  const user = await requireAcceptedUser("/sell/private");
  if (user.role === "DEALER") redirect("/sell/dealer");
  const params = searchParams ? await searchParams : {};
  const draftId = params.draft?.trim();

  const [{ categories, regions, vehicleMakes }, isFreeForUser] = await Promise.all([
    getSellFormData(),
    isPrivateListingFreeForUser(user.id),
  ]);
  const initialDraft = draftId
    ? await getEditableDraft({
        draftId,
        userId: user.id,
        dealerId: null,
      })
    : null;
  if (draftId && !initialDraft) {
    redirect("/account/listings?status=DRAFT");
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      {isFreeForUser ? <FreeListingWelcomeDialog /> : null}
      <h1 className="text-3xl font-bold text-text-primary mb-2">
        {initialDraft ? "Continue Editing Your Draft" : "Create a Private Listing"}
      </h1>
      <p className="text-text-secondary mb-3">
        {initialDraft
          ? "Pick up where you left off, update your saved draft, and continue to checkout when you are ready."
          : "List your item as a private seller. Your listing will be reviewed by our moderation team before going live."}
      </p>
      <p className="text-sm text-text-secondary mb-8">
        Need higher monthly inventory?{" "}
        <Link href="/dealer/subscribe?tier=STARTER" className="text-text-trust hover:underline">
          Become a dealer
        </Link>
        .
      </p>

      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={vehicleMakes}
        mode="private"
        isFreeForUser={isFreeForUser}
        initialDraft={initialDraft}
      />
    </div>
  );
}
